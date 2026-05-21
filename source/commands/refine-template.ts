// Shared core for the template-refine flow. Diagnoses one pull's live
// render against its design and applies user-approved fixes.
//
// Pipeline:
//   1. Read design/<slug>/screenshot.png. Its pixel dimensions drive
//      the browser viewport for capture.
//   2. Resolve the running site URL via ~/.studio/cli.json, append the
//      pull's previewPath. Capture the live page at design.width ×
//      design.height (DPR=1, viewport-only). Save as live.png.
//   3. odiff design.png vs live.png → diff.png + a pixel-diff ratio.
//      If under threshold (0.5%), report "matches" and exit.
//   4. visual-diff agent: 3 images + current template → JSON report.
//      If `matches_design: true`, exit with success.
//   5. Caller (refine-templates.tsx) lets the user pick which diffs to
//      apply (default-all-selected) and submits the approved subset.
//   6. apply-diff agent: selected diffs + current template + theme.json
//      + variables.json + existing block style variations + dev
//      annotations + the per-pull media library mappings (uploaded
//      constName→{id, url} plus discarded-SVG constName→description)
//      → updated markup. Overwrite the template.
//
// All artifacts (live.png, diff.png, template-diff-report.json) live
// alongside the design screenshot for inspection. This module owns no
// React; the UI shell lives in refine-templates.tsx.
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileAtomic} from '../lib/atomic-write.js';
import {AgentAbortedError, runAgent} from '../lib/agent-stream.js';
import {captureAtSize} from '../lib/browser-capture.js';
import {readIfExists} from '../lib/fs-helpers.js';
import {
	captureAndDiffPull,
	CaptureAbortedError,
	PIXEL_DIFF_THRESHOLD,
	type DiffPull,
} from '../lib/template-diff.js';
import {
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {
	extractDevAnnotations,
	formatDevAnnotationsSection,
} from '../lib/dev-annotations.js';
import type {LogEvent} from '../lib/event-list.js';
import {HAYDI_TOOL_ALLOWLIST, haydiMcpServers} from '../lib/haydi-mcp.js';
import {preflight, readTemplateViaHaydi} from '../integrations/haydi/client.js';
import {
	dArrayLenient,
	dBoolean,
	dEnum,
	dNullable,
	dObject,
	dString,
	dStringy,
	decode,
} from '../lib/decode.js';
import {templateRole, templateSubdir} from '../lib/template-scaffold.js';
import {formatAssetMappingsContext} from '../lib/asset-mappings.js';
import {scopeForTemplate} from './build-template.js';
import {
	targetLabel,
	templateTargetFor,
	type TemplateTarget,
} from '../lib/wp-templates.js';
import {parseAgentJson} from '../lib/build-envelope.js';
import type {HaydiConfig, Loaded} from './setup-project/types.js';

export type DiffEntry = {
	id: string;
	region: string;
	severity: 'high' | 'medium' | 'low';
	description: string;
	block_change?: string | null;
	style_change?: string | null;
	affects_layout: boolean;
};

export type DiffReport = {
	summary: string;
	matches_design: boolean;
	diffs: DiffEntry[];
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

type DiagnoseDeps = {
	runAgent?: typeof runAgent;
	captureAtSize?: typeof captureAtSize;
};

export type DiagnoseResult =
	| {kind: 'matched'; ratio: number}
	| {
			kind: 'report';
			report: DiffReport;
			currentTemplate: string;
			target: TemplateTarget;
			themeJsonText: string | null;
			variablesText: string | null;
			devAnnotationsText: string | null;
			existingVariationsText: string | null;
	  };

export async function runDiagnose(
	loaded: Loaded,
	pull: DiffPull,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: DiagnoseDeps = {},
): Promise<DiagnoseResult> {
	const agentRunner = deps.runAgent ?? runAgent;
	const capture = deps.captureAtSize ?? captureAtSize;

	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config.json — finish theme setup first.',
		);
	}
	const haydi = loaded.config.haydi;
	if (!haydi) {
		throw new Error(
			'haydi config missing from neptune-config.json. Refine template reads + writes the template post via Haydi MCP; add { "haydi": { "url": "...", "token": "..." } } to the project config.',
		);
	}
	onEvent({kind: 'step', message: `Pinging Haydi at ${haydi.url}…`});
	await preflight(haydi, signal);
	onEvent({kind: 'step', message: 'Haydi extensions verified'});

	const target = templateTargetFor(pull.templateFile, pull.pageName);
	const filePath = templatePath(loaded.dir, themeSlug, pull.templateFile);
	const currentTemplate = await loadCurrentTemplate(
		haydi,
		target,
		filePath,
		signal,
	);
	if (!currentTemplate.trim()) {
		throw new Error(
			`No template content found for ${targetLabel(target)}. Run Build templates first.`,
		);
	}
	onEvent({
		kind: 'step',
		message: `Loaded current template (${currentTemplate.length} bytes)`,
	});

	let captured;
	try {
		captured = await captureAndDiffPull(loaded, pull, signal, onEvent, {
			captureAtSize: capture,
		});
	} catch (err) {
		if (err instanceof CaptureAbortedError) throw new AgentAbortedError();
		throw err;
	}
	const {designBuf, liveBuf, diffPath, outcome, sizeNote} = captured;

	if (!outcome.ok) {
		throw new Error(`odiff failed: ${outcome.reason} ${outcome.file ?? ''}`);
	}

	if (outcome.match) {
		onEvent({kind: 'success', message: 'Pixel-perfect match'});
		return {kind: 'matched', ratio: 0};
	}

	// odiff returns layout-diff only when padding fails or is skipped;
	// captureAndDiffPull always pads to a common canvas first. Treat
	// any non-match as pixel-diff.
	if (outcome.kind !== 'pixel-diff') {
		throw new Error(
			'Padded diff produced layout-diff — should be unreachable.',
		);
	}

	if (outcome.diffPercentage < PIXEL_DIFF_THRESHOLD && !sizeNote) {
		onEvent({
			kind: 'success',
			message: `Diff ${outcome.diffPercentage.toFixed(2)}% < ${PIXEL_DIFF_THRESHOLD}% threshold; treating as match`,
		});
		return {kind: 'matched', ratio: outcome.diffPercentage};
	}

	onEvent({
		kind: 'step',
		message: `Diff ${outcome.diffCount} px (${outcome.diffPercentage.toFixed(2)}%) → diff.png`,
	});
	const diffBase64 = (await readFile(diffPath)).toString('base64');

	const themeJsonPath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		'theme.json',
	);
	const themeJsonText = await readIfExists(themeJsonPath);
	const variablesText = await readIfExists(
		join(loaded.dir, 'variables', 'all-variables.json'),
	);
	const themePath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
	);
	const existingVariations = await readBlockStyleVariations(themePath, msg =>
		onEvent({kind: 'warn', message: msg}),
	);
	const existingVariationsText =
		formatBlockStyleVariationsContext(existingVariations);
	if (existingVariationsText) {
		onEvent({
			kind: 'step',
			message: `Loaded ${existingVariations.length} existing block style variation${existingVariations.length === 1 ? '' : 's'} for reuse context`,
		});
	}

	// code.tsx carries inline data-development-annotations the designer
	// authored in Figma. Surface them to both agents as explicit context;
	// missing or annotation-less files just produce a null section.
	const codeText = await readIfExists(
		join(loaded.dir, 'design', pull.slug, 'code.tsx'),
	);
	const devAnnotations = codeText ? extractDevAnnotations(codeText) : [];
	const devAnnotationsText =
		devAnnotations.length > 0
			? formatDevAnnotationsSection(devAnnotations)
			: null;
	if (devAnnotationsText) {
		const noteCount = devAnnotations.reduce(
			(sum, a) => sum + a.notes.length,
			0,
		);
		onEvent({
			kind: 'step',
			message: `Captured ${noteCount} dev annotation${noteCount === 1 ? '' : 's'} on ${devAnnotations.length} node${devAnnotations.length === 1 ? '' : 's'}`,
		});
	}

	const designBase64 = designBuf.toString('base64');
	const liveBase64 = liveBuf.toString('base64');

	onEvent({kind: 'step', message: 'Invoking visual-diff agent…'});

	const diffScope = scopeForTemplate(
		templateRole(pull.templateFile),
		pull.usesPostContent === true,
	);
	const headerParts: string[] = [
		`Use the visual-diff skill.`,
		`SCOPE: ${diffScope}.`,
		`Template file: ${pull.templateFile}.`,
		`Pixel-diff ratio: ${outcome.diffPercentage.toFixed(2)}%.`,
	];
	if (sizeNote) {
		headerParts.push(sizeNote);
	}

	const reportText = await agentRunner(
		[
			{type: 'text', text: headerParts.join(' ')},
			{type: 'text', text: '=== design.png — target (Figma) ==='},
			{
				type: 'image',
				source: {type: 'base64', media_type: 'image/png', data: designBase64},
			},
			{type: 'text', text: '=== live.png — current render ==='},
			{
				type: 'image',
				source: {type: 'base64', media_type: 'image/png', data: liveBase64},
			},
			{type: 'text', text: '=== diff.png — pixel-difference highlight ==='},
			{
				type: 'image',
				source: {type: 'base64', media_type: 'image/png', data: diffBase64},
			},
			{
				type: 'text',
				text: buildContextSection(
					currentTemplate,
					themeJsonText,
					devAnnotationsText,
					existingVariationsText,
				),
			},
			{
				type: 'text',
				text: 'Respond with the JSON envelope ONLY. Begin your reply with `{` and end with `}`. No preamble, no analysis, no commentary, no markdown fences, no trailing summary.',
			},
		],
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	const report = parseDiffReport(reportText, msg =>
		onEvent({kind: 'warn', message: msg}),
	);
	const reportPath = join(
		loaded.dir,
		'design',
		pull.slug,
		'template-diff-report.json',
	);
	await writeFileAtomic(reportPath, JSON.stringify(report, null, 2) + '\n');
	onEvent({
		kind: 'step',
		message: `Wrote template-diff-report.json (${report.diffs.length} diff${
			report.diffs.length === 1 ? '' : 's'
		})`,
	});

	if (report.matches_design) {
		const ratio = outcome.kind === 'pixel-diff' ? outcome.diffPercentage : 0;
		return {kind: 'matched', ratio};
	}

	return {
		kind: 'report',
		report,
		currentTemplate,
		target,
		themeJsonText,
		variablesText,
		devAnnotationsText,
		existingVariationsText,
	};
}

type ApplyDeps = {
	runAgent?: typeof runAgent;
};

export type AppliedEntry = {
	id: string;
	summary: string;
};

export type SkippedEntry = {
	id: string;
	reason: string;
};

export async function runApply(
	loaded: Loaded,
	reviewPhase: {
		pull: DiffPull;
		currentTemplate: string;
		target: TemplateTarget;
		themeJsonText: string | null;
		variablesText: string | null;
		devAnnotationsText: string | null;
		existingVariationsText: string | null;
	},
	approved: DiffEntry[],
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: ApplyDeps = {},
): Promise<{
	path: string;
	size: number;
	applied: AppliedEntry[];
	skipped: SkippedEntry[];
}> {
	const agentRunner = deps.runAgent ?? runAgent;

	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config.json — finish theme setup first.',
		);
	}
	const haydi = loaded.config.haydi;
	if (!haydi) {
		throw new Error(
			'haydi config missing from neptune-config.json. Refine template persists via Haydi MCP; add { "haydi": { "url": "...", "token": "..." } } to the project config.',
		);
	}
	onEvent({kind: 'step', message: `Pinging Haydi at ${haydi.url}…`});
	await preflight(haydi, signal);
	onEvent({kind: 'step', message: 'Haydi extensions verified'});

	const themePath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
	);
	const themeJsonPath = resolve(themePath, 'theme.json');

	const sections: string[] = [
		'=== diffs.json ===',
		JSON.stringify(approved, null, 2),
		'',
		'=== current.html ===',
		reviewPhase.currentTemplate,
	];
	if (reviewPhase.themeJsonText) {
		sections.push('', '=== theme.json ===', reviewPhase.themeJsonText);
	}
	if (reviewPhase.variablesText) {
		sections.push('', '=== variables.json ===', reviewPhase.variablesText);
	}
	if (reviewPhase.existingVariationsText) {
		sections.push(
			'',
			'=== existing block style variations ===',
			reviewPhase.existingVariationsText,
		);
	}
	if (reviewPhase.devAnnotationsText) {
		sections.push(
			'',
			'=== dev annotations ===',
			reviewPhase.devAnnotationsText,
		);
	}
	const assetMappings = formatAssetMappingsContext(
		reviewPhase.pull.assets,
		reviewPhase.pull.discardedAssets,
	);
	if (assetMappings) {
		sections.push('', '=== media library mappings ===', assetMappings);
	}

	const applyScope = scopeForTemplate(
		templateRole(reviewPhase.pull.templateFile),
		reviewPhase.pull.usesPostContent === true,
	);

	const instructions =
		`Use the apply-diff skill (SCOPE: ${applyScope}) to revise the existing template markup per the approved diffs below. Persist every artifact yourself via the pull-writer recipes.\n\n` +
		`Target wp_template:\n` +
		`  type  = ${reviewPhase.target.type}\n` +
		`  slug  = ${reviewPhase.target.slug}\n` +
		`  title = ${JSON.stringify(reviewPhase.target.title)}\n\n` +
		`Theme paths:\n` +
		`  theme.json     = ${themeJsonPath}\n` +
		`  variations dir = ${join(themePath, 'styles', 'blocks')}\n\n` +
		`Persistence order (from pull-writer):\n` +
		`  1. Recipe 2 (Template write) — persist the revised markup.\n` +
		`  2. Recipe 6 (theme.json Read + Write) — only if a diff legitimately requires extending styles.blocks or settings.custom.\n` +
		`  3. Recipe 7 (variation file Write) — only if a diff legitimately requires a NEW editor-pickable variation; reuse existing ones from the inventory first.\n` +
		`  4. Recipe 5 (cache flush) — once at the end, iff Recipe 6 or 7 ran.\n\n` +
		`Final response: one terse persistence line per artifact, plus an APPLIED or SKIPPED line for every diff id in the input. Format:\n` +
		`  APPLIED <diff-id>: <one-line summary of the change you made>\n` +
		`  SKIPPED <diff-id>: <one-sentence reason>\n` +
		`Every diff id MUST appear exactly once across APPLIED + SKIPPED — the host enforces coverage.`;

	onEvent({
		kind: 'step',
		message: 'Invoking apply-diff agent (persists via Haydi)…',
	});

	const finalText = await agentRunner(
		[
			{type: 'text', text: instructions},
			{type: 'text', text: sections.join('\n')},
		],
		{
			cwd: loaded.dir,
			pluginPath: PLUGIN_PATH,
			signal,
			mcpServers: haydiMcpServers(haydi),
			allowedTools: [
				'Read',
				'Edit',
				'Write',
				'Glob',
				'Grep',
				...HAYDI_TOOL_ALLOWLIST,
			],
			maxTurns: 30,
		},
		onEvent,
	);

	const {applied, skipped} = parseApplyOutcomes(finalText);
	validateOutcomeCoverage(
		applied,
		skipped,
		approved.map(a => a.id),
	);

	for (const entry of applied) {
		onEvent({
			kind: 'success',
			message: `Applied ${entry.id}: ${entry.summary}`,
		});
	}
	for (const entry of skipped) {
		onEvent({
			kind: 'warn',
			message: `Skipped ${entry.id}: ${entry.reason}`,
		});
	}

	// Post-flight: read the template back from Haydi and confirm
	// non-empty content. If the agent dropped APPLIED/SKIPPED summary
	// lines but didn't actually persist, fail loud now.
	const persisted = await readTemplateViaHaydi(
		haydi,
		{type: reviewPhase.target.type, slug: reviewPhase.target.slug},
		signal,
	);
	const label = targetLabel(reviewPhase.target);
	if (persisted === null) {
		throw new Error(
			`Agent finished but no ${label} post was found via Haydi. The apply likely failed silently.\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}
	const size = persisted.length;
	if (size === 0) {
		throw new Error(
			`Agent finished but ${label} has empty post_content.\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}

	onEvent({kind: 'success', message: `Wrote ${size} bytes to ${label}`});

	return {
		path: label,
		size,
		applied,
		skipped,
	};
}

// Parses the agent's terse summary lines, picking out APPLIED <id>:
// <summary> and SKIPPED <id>: <reason> entries. Tolerates leading
// whitespace, blank lines, and other persistence summary lines
// (`wrote ...`, `edited ...`, `flushed ...`) — anything not matching
// the prefix is ignored.
//
// Format chosen for parseability against agent output that may include
// other narration: the `APPLIED `/`SKIPPED ` prefix anchors the line,
// the first `:` after the id separates id from text. Ids that contain
// `:` are not supported (diff ids in practice are slug-shaped).
export function parseApplyOutcomes(text: string): {
	applied: AppliedEntry[];
	skipped: SkippedEntry[];
} {
	const applied: AppliedEntry[] = [];
	const skipped: SkippedEntry[] = [];
	for (const line of text.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (trimmed === '') continue;
		const m = /^(APPLIED|SKIPPED)\s+([^\s:][^:]*?):\s+(.+)$/.exec(trimmed);
		if (!m) continue;
		const [, kind, id, rest] = m;
		const entry = {id: id!.trim(), text: rest!.trim()};
		if (kind === 'APPLIED') {
			applied.push({id: entry.id, summary: entry.text});
		} else {
			skipped.push({id: entry.id, reason: entry.text});
		}
	}
	return {applied, skipped};
}

// Verifies every approved diff id appears exactly once across applied
// + skipped. The host fails the run if any id is missing — silent diff
// drops are the old envelope's failure mode and we keep that contract.
export function validateOutcomeCoverage(
	applied: AppliedEntry[],
	skipped: SkippedEntry[],
	approvedIds: string[],
): void {
	const accounted = new Set([
		...applied.map(a => a.id),
		...skipped.map(s => s.id),
	]);
	const missing = approvedIds.filter(id => !accounted.has(id));
	if (missing.length === 0) return;
	throw new Error(
		`apply-diff agent did not account for diff id${
			missing.length === 1 ? '' : 's'
		}: ${missing.join(', ')}. ` +
			'Each approved diff must appear in an APPLIED or SKIPPED summary line.',
	);
}

// Loads the current template content from the database first (where
// Site Editor and Neptune both write); falls back to the theme's
// shipped file if there's no DB row yet.
async function loadCurrentTemplate(
	haydi: HaydiConfig,
	target: TemplateTarget,
	filePath: string,
	signal: AbortSignal,
): Promise<string> {
	const dbContent = await readTemplateViaHaydi(
		haydi,
		{type: target.type, slug: target.slug},
		signal,
	);
	if (dbContent !== null) return dbContent;

	try {
		return await readFile(filePath, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(
				`Template ${targetLabel(target)} doesn't exist yet (no DB row, no file at ${filePath}). Run Build templates first.`,
			);
		}
		throw err;
	}
}

function buildContextSection(
	currentTemplate: string,
	themeJsonText: string | null,
	devAnnotationsText: string | null,
	existingVariationsText: string | null,
): string {
	const parts = ['=== current.html ===', currentTemplate];
	if (themeJsonText) {
		parts.push('', '=== theme.json ===', themeJsonText);
	}
	if (existingVariationsText) {
		parts.push(
			'',
			'=== existing block style variations ===',
			'These variations are already registered in this theme. When proposing a diff that needs an alternative block style, prefer reusing one of these (apply the matching `is-style-<slug>` class) over inventing a new one.',
			existingVariationsText,
		);
	}
	if (devAnnotationsText) {
		parts.push('', '=== dev annotations ===', devAnnotationsText);
	}
	return parts.join('\n');
}

// `id` and `severity` stay strict — `id` becomes a Set key (duplicates
// drop the second occurrence) and `severity` is an enum. Free-form
// text fields use `dStringy` so an entry isn't lost when the model
// occasionally emits a structured object for a value the schema
// expected as prose (e.g. `block_change: {"from":"wp:p","to":"wp:heading"}`).
const dDiffEntry = dObject({
	id: dString,
	region: dStringy,
	severity: dEnum('high', 'medium', 'low'),
	description: dStringy,
	block_change: dNullable(dStringy),
	style_change: dNullable(dStringy),
	affects_layout: dBoolean,
});

// Validates and narrows the visual-diff agent's response. Throws on
// top-level schema mismatch; per-entry failures are reported via
// onWarn and the entry is dropped. Duplicate ids are dropped first-wins.
export function parseDiffReport(
	input: string,
	onWarn?: (msg: string) => void,
): DiffReport {
	const parsed = parseAgentJson(input, 'visual-diff');
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('visual-diff response is not a JSON object');
	}
	const obj = parsed as Record<string, unknown>;
	const summary = typeof obj['summary'] === 'string' ? obj['summary'] : '';
	const matchesDesign = obj['matches_design'] === true;

	if (matchesDesign) return {summary, matches_design: true, diffs: []};

	const rawDiffs = decode(
		dArrayLenient(dDiffEntry, (path, err) => {
			onWarn?.(`Dropped diff entry at ${path}: ${err.message}`);
		}),
		obj['diffs'] ?? [],
		'visual-diff.diffs',
	);

	const seen = new Set<string>();
	const diffs: DiffEntry[] = [];
	for (const entry of rawDiffs) {
		if (seen.has(entry.id)) {
			onWarn?.(`Dropped duplicate diff id "${entry.id}"`);
			continue;
		}
		seen.add(entry.id);
		diffs.push({
			id: entry.id,
			region: entry.region,
			severity: entry.severity,
			description: entry.description,
			block_change: entry.block_change ?? undefined,
			style_change: entry.style_change ?? undefined,
			affects_layout: entry.affects_layout,
		});
	}

	return {summary, matches_design: false, diffs};
}

function templatePath(
	projectDir: string,
	themeSlug: string,
	templateFile: string,
): string {
	return resolve(
		projectDir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		templateSubdir(templateFile),
		templateFile,
	);
}
