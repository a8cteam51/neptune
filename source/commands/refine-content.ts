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
//      theme.json + variables → updated post-content markup. Persist
//      via wp neptune page-set.
//
// Reuses pure helpers from refine-template.ts (parseDiffReport,
// parseApplyEnvelope, validateApplyCoverage) since the agent envelopes
// are identical — only the persistence target differs.
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
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	flushThemeJsonCache,
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {
	extractDevAnnotations,
	formatDevAnnotationsSection,
} from '../lib/dev-annotations.js';
import type {LogEvent} from '../lib/event-list.js';
import {openStudioSession} from '../integrations/studio/mcp.js';
import {placeholderInstructions} from './build-template.js';
import {
	pageTargetFor,
	pageTargetLabel,
	readPage,
	writePage,
	type PageTarget,
} from '../lib/wp-pages.js';
import {
	parseApplyEnvelope,
	parseDiffReport,
	validateApplyCoverage,
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

	const target = pageTargetFor(pull.pageSlug, pull.pageName);
	const wpRoot = resolve(loaded.dir, 'wordpress');

	const currentContent = await loadCurrentPage(wpRoot, target, signal);
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
		`Compare these screenshots of the same WordPress page.`,
		`Use the visual-diff skill.`,
		`Page slug: ${pull.pageSlug}.`,
		`Pixel-diff ratio: ${outcome.diffPercentage.toFixed(2)}%.`,
		`SCOPE: flag ONLY diffs inside the page body (post-content). Ignore wrapper chrome — site header, primary nav, footer, post-title, post-date, comments — those belong to the surrounding template (${pull.templateFile}) and are refined separately. The current.html provided is the page body markup only; diffs that target chrome regions cannot be applied here.`,
	];
	if (sizeNote) {
		headerParts.push(
			`${sizeNote} Both images were padded to a common canvas before diffing; magenta regions in diff.png mark areas where one side has no content (i.e. one side is taller/wider than the other).`,
		);
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
	themeJsonTouched: string[];
}> {
	const agentRunner = deps.runAgent ?? runAgent;

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
			'These variations are already registered in this theme. Reuse them by applying the matching `is-style-<slug>` class instead of redefining them. Only emit a new entry in `block_style_variations[]` when none of these fits.',
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
	const placeholder = loaded.config.placeholderImage;
	if (placeholder) {
		sections.push(
			'',
			'=== placeholder image ===',
			placeholderInstructions(placeholder),
		);
	}

	onEvent({kind: 'step', message: 'Invoking apply-diff agent…'});

	const responseText = await agentRunner(
		[
			{
				type: 'text',
				text:
					`Apply this list of approved visual diffs to the existing Gutenberg block markup that constitutes the BODY (post_content) of a WordPress page (slug: ${reviewPhase.pull.pageSlug}). ` +
					`Use the apply-diff skill. Apply only the supplied diffs; do not introduce new ones. ` +
					`SCOPE: current.html is the page body only — NOT a template. Do NOT emit wp:template-part references, wp:post-title, wp:post-date, or any chrome. Do NOT emit wp:post-content (this output IS the post content). If a diff targets a region that isn't present in current.html (header, footer, post-title, etc.), skip it with that reason. ` +
					`Return the JSON envelope described in the skill. Neptune persists the page and applies the optional theme.json patch directly — do NOT call any tools yourself.`,
			},
			{type: 'text', text: sections.join('\n')},
		],
		{
			cwd: loaded.dir,
			pluginPath: PLUGIN_PATH,
			signal,
		},
		onEvent,
	);

	const envelope = parseApplyEnvelope(responseText, msg =>
		onEvent({kind: 'warn', message: msg}),
	);
	validateApplyCoverage(
		envelope,
		approved.map(a => a.id),
	);

	for (const entry of envelope.applied) {
		onEvent({
			kind: 'success',
			message: `Applied ${entry.id}: ${entry.summary}`,
		});
	}
	for (const entry of envelope.skipped) {
		onEvent({
			kind: 'warn',
			message: `Skipped ${entry.id}: ${entry.reason}`,
		});
	}

	const out = envelope.template_html.endsWith('\n')
		? envelope.template_html
		: envelope.template_html + '\n';

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config.json — finish theme setup first.',
		);
	}
	const themeJsonPath = resolve(
		wpRoot,
		'wp-content',
		'themes',
		themeSlug,
		'theme.json',
	);

	let themeJsonTouched: string[] = [];
	const themePath = resolve(wpRoot, 'wp-content', 'themes', themeSlug);
	const session = await openStudioSession({signal});
	let cacheNeedsFlush = false;
	try {
		await writePage(session, wpRoot, reviewPhase.target, out);
		if (envelope.theme_json_patch) {
			const patchResult = await applyThemeJsonPatch(
				themeJsonPath,
				envelope.theme_json_patch,
			);
			if (patchResult.wrote) {
				themeJsonTouched = patchResult.touched;
				onEvent({
					kind: 'success',
					message: `Patched theme.json (${patchResult.touched.join(', ')})`,
				});
				cacheNeedsFlush = true;
			}
		}
		if (envelope.block_style_variations) {
			const writeResult = await applyBlockStyleVariations(
				themePath,
				envelope.block_style_variations,
			);
			if (writeResult.written.length > 0) {
				onEvent({
					kind: 'success',
					message: `Registered ${writeResult.written.length} block style variation${writeResult.written.length === 1 ? '' : 's'}`,
				});
				cacheNeedsFlush = true;
			}
		}
		if (cacheNeedsFlush) {
			await flushThemeJsonCache(session, wpRoot);
		}
	} finally {
		session.close();
	}

	const label = pageTargetLabel(reviewPhase.target);
	onEvent({
		kind: 'success',
		message: `Wrote ${out.length} bytes to ${label}`,
	});

	return {
		path: label,
		size: out.length,
		applied: envelope.applied,
		skipped: envelope.skipped,
		themeJsonTouched,
	};
}

// Loads the current page-post content from the database. Unlike
// templates there's no theme-file fallback — pages live only in the DB,
// so a missing row means Build content hasn't run yet.
async function loadCurrentPage(
	wpRoot: string,
	target: PageTarget,
	signal: AbortSignal,
): Promise<string> {
	const session = await openStudioSession({signal});
	let dbResult;
	try {
		dbResult = await readPage(session, wpRoot, target);
	} finally {
		session.close();
	}
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
