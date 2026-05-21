// Shared core for the page-content refine flow. Mirrors refine-template
// but targets a wp_post (page) instead of a wp_template post.
//
// Pipeline:
//   1. Read design/<slug>/screenshot.png and capture the live page at
//      its dimensions (full viewport — page-role wrapper template renders
//      header/footer/post-content in one shot).
//   2. odiff design.png vs live.png → diff.png + ratio. Match → exit.
//   3. visual-diff agent: 3 images + current page-post markup → JSON
//      report. The agent is told to flag ONLY diffs inside the page
//      body — wrapper chrome (header, primary nav, footer, post-title,
//      comments, etc.) belongs to the template and is refined elsewhere.
//   4. Caller approves the diff subset.
//   5. apply-diff agent: selected diffs + current page markup +
//      theme.json + variables + existing block style variations + dev
//      annotations + the per-pull media library mappings (uploaded
//      constName→{id, url} plus discarded-SVG constName→description)
//      → updated post-content markup. Persist via Haydi run_php.
//
// Reuses pure helpers from refine-template.ts (parseDiffReport,
// parseApplyOutcomes, validateOutcomeCoverage) since the agent
// surfaces are identical — only the persistence target differs.
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
import {formatAssetMappingsContext} from '../lib/asset-mappings.js';
import {preflight, readPageViaHaydi} from '../integrations/haydi/client.js';
import {
	pageTargetFor,
	pageTargetLabel,
	type PageTarget,
} from '../lib/wp-pages.js';
import type {HaydiConfig} from './setup-project/types.js';
import {
	parseApplyOutcomes,
	parseDiffReport,
	validateOutcomeCoverage,
	type AppliedEntry,
	type DiffEntry,
	type DiffReport,
	type SkippedEntry,
} from './refine-template.js';
import type {Loaded} from './setup-project/types.js';

// A pull eligible for content refine: must have a templateFile so we
// can capture the live render, plus a pageSlug pointing at the wp_post
// that hosts the post body.
export type ContentPull = DiffPull & {pageSlug: string};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

type DiagnoseDeps = {
	runAgent?: typeof runAgent;
	captureAtSize?: typeof captureAtSize;
};

export type DiagnoseContentResult =
	| {kind: 'matched'; ratio: number}
	| {
			kind: 'report';
			report: DiffReport;
			currentContent: string;
			target: PageTarget;
			themeJsonText: string | null;
			variablesText: string | null;
			devAnnotationsText: string | null;
			existingVariationsText: string | null;
	  };

export async function runDiagnoseContent(
	loaded: Loaded,
	pull: ContentPull,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: DiagnoseDeps = {},
): Promise<DiagnoseContentResult> {
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
			'haydi config missing from neptune-config.json. Refine content reads + writes the page post via Haydi MCP; add { "haydi": { "url": "...", "token": "..." } } to the project config.',
		);
	}
	onEvent({kind: 'step', message: `Pinging Haydi at ${haydi.url}…`});
	await preflight(haydi, signal);
	onEvent({kind: 'step', message: 'Haydi extensions verified'});

	const target = pageTargetFor(
		pull.pageSlug,
		pull.pageName,
		pull.postType ?? 'page',
	);

	const currentContent = await loadCurrentPage(haydi, target, signal);
	onEvent({
		kind: 'step',
		message: `Loaded current page content (${currentContent.length} bytes)`,
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

	const headerParts: string[] = [
		`Use the visual-diff skill.`,
		`SCOPE: POST-CONTENT-BODY.`,
		`Page slug: ${pull.pageSlug}.`,
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
					currentContent,
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
		'content-diff-report.json',
	);
	await writeFileAtomic(reportPath, JSON.stringify(report, null, 2) + '\n');
	onEvent({
		kind: 'step',
		message: `Wrote content-diff-report.json (${report.diffs.length} diff${
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
		currentContent,
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

export async function runApplyContent(
	loaded: Loaded,
	reviewPhase: {
		pull: ContentPull;
		currentContent: string;
		target: PageTarget;
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
			'haydi config missing from neptune-config.json. Refine content persists via Haydi MCP; add { "haydi": { "url": "...", "token": "..." } } to the project config.',
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
		reviewPhase.currentContent,
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

	const instructions =
		`Use the apply-diff skill (SCOPE: POST-CONTENT-BODY) to revise the page body markup per the approved diffs below. Persist via the pull-writer recipes.\n\n` +
		`Target wp_post:\n` +
		`  postType = ${reviewPhase.target.postType}\n` +
		`  slug     = ${reviewPhase.target.slug}\n` +
		`  title    = ${JSON.stringify(reviewPhase.target.title)}\n\n` +
		`Theme paths (for theme.json or variation edits if a diff requires them):\n` +
		`  theme.json     = ${themeJsonPath}\n` +
		`  variations dir = ${join(themePath, 'styles', 'blocks')}\n\n` +
		`Persistence order (from pull-writer):\n` +
		`  1. Recipe 4 (Page / post write) — persist the revised page body.\n` +
		`  2. Recipe 6 (theme.json Read + Write) — only if a diff legitimately requires extending styles.blocks or settings.custom. Page bodies rarely register project-wide styles; default to NOT touching theme.json.\n` +
		`  3. Recipe 7 (variation file Write) — only if a diff legitimately requires a NEW editor-pickable variation; reuse existing ones first.\n` +
		`  4. Recipe 5 (cache flush) — once at the end, iff Recipe 6 or 7 ran.\n\n` +
		`Final response: one terse persistence line per artifact, plus an APPLIED or SKIPPED line for every diff id in the input. Format:\n` +
		`  APPLIED <diff-id>: <one-line summary of the change>\n` +
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

	const persisted = await readPageViaHaydi(
		haydi,
		{
			postType: reviewPhase.target.postType,
			slug: reviewPhase.target.slug,
		},
		signal,
	);
	const label = pageTargetLabel(reviewPhase.target);
	if (persisted === null) {
		throw new Error(
			`Agent finished but no ${label} post was found via Haydi.\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}
	const size = persisted.content.length;
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

// Loads the current page-post content from the database. Unlike
// templates there's no theme-file fallback — pages live only in the DB,
// so a missing row means Build content hasn't run yet.
async function loadCurrentPage(
	haydi: HaydiConfig,
	target: PageTarget,
	signal: AbortSignal,
): Promise<string> {
	const dbResult = await readPageViaHaydi(
		haydi,
		{postType: target.postType, slug: target.slug},
		signal,
	);
	if (dbResult === null) {
		throw new Error(
			`No page post found for ${pageTargetLabel(target)}. Run Build content first.`,
		);
	}
	if (!dbResult.content.trim()) {
		throw new Error(
			`Page post ${pageTargetLabel(target)} has empty content. Run Build content first.`,
		);
	}
	return dbResult.content;
}

function buildContextSection(
	currentContent: string,
	themeJsonText: string | null,
	devAnnotationsText: string | null,
	existingVariationsText: string | null,
): string {
	const parts = ['=== current.html ===', currentContent];
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
