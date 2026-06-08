// The standardize + fact-check pass — the core value-add of the Claude
// Design branch. Claude Design ships near-final block markup plus a big
// hand-written style.css. This pass enforces Neptune's styling standard
// at "maximize standards" aggressiveness: it folds every style.css rule
// that can be expressed structurally into theme.json (styles.elements,
// styles.blocks) or a named block style variation, rewrites the markup
// to drop the now-redundant classNames (or swap them for is-style-<slug>),
// and leaves only the genuinely inexpressible rules (dark-mode toggle,
// CSS counters, pseudo/descendant selectors) in a trimmed residual
// style.css. It also audits theme.json completeness.
//
// Per the user's choice this is AUTO-APPLY: results are written straight
// to disk; the downstream visual-diff refine loop is the safety net for
// any regression. Markup is NOT written to the WP database here — the
// caller does that over its shared Studio session (see import core).
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runAgent} from '../../lib/agent-stream.js';
import {writeFileAtomic} from '../../lib/atomic-write.js';
import {
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../../lib/theme-json-patch.js';
import type {LogEvent} from '../../lib/event-list.js';
import {parseStandardizeEnvelope} from './standardize-envelope.js';
import {stripNonBlockComments} from './clean-markup.js';
import {DESIGN_CSS_REL, type ClaudeDesignManifest} from './contract.js';

export type StandardizeDeps = {
	runAgent?: typeof runAgent;
};

export type StandardizeResult = {
	// Final block markup per relative path ("templates/index.html", …):
	// standardized where the agent rewrote it, original otherwise. The
	// caller writes these to the WP database.
	markup: Record<string, string>;
	residualWritten: boolean;
	variationsWritten: number;
	patchTouched: string[];
	reclassifiedCount: number;
	keptCount: number;
};

// Reads every template/part's markup off disk (post theme-copy), keyed by
// the relative path the skill will echo back in `files`.
async function readMarkupMap(
	manifest: ClaudeDesignManifest,
): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const t of manifest.templates) {
		out[`templates/${t}`] = await readFile(
			join(manifest.templatesDir, t),
			'utf8',
		);
	}
	for (const p of manifest.parts) {
		out[`parts/${p}`] = await readFile(join(manifest.partsDir, p), 'utf8');
	}
	return out;
}

export async function runStandardize(
	manifest: ClaudeDesignManifest,
	themeDir: string,
	opts: {cwd: string; pluginPath: string; signal: AbortSignal},
	onEvent: (ev: LogEvent) => void,
	deps: StandardizeDeps = {},
): Promise<StandardizeResult> {
	const agentRunner = deps.runAgent ?? runAgent;

	const themeJsonPath = join(themeDir, 'theme.json');
	const themeJsonText = await readFile(themeJsonPath, 'utf8');
	const styleCssText = manifest.styleCssPath
		? await readFile(manifest.styleCssPath, 'utf8')
		: '';
	const markup = await readMarkupMap(manifest);

	const existingVariations = await readBlockStyleVariations(themeDir, msg =>
		onEvent({kind: 'warn', message: msg}),
	);
	const variationsContext =
		formatBlockStyleVariationsContext(existingVariations);

	if (!styleCssText.trim() && Object.keys(markup).length === 0) {
		onEvent({
			kind: 'warn',
			message: 'Nothing to standardize (no style.css and no templates).',
		});
		return {
			markup,
			residualWritten: false,
			variationsWritten: 0,
			patchTouched: [],
			reclassifiedCount: 0,
			keptCount: 0,
		};
	}

	const sections: string[] = [];
	sections.push('=== theme.json (current) ===', themeJsonText);
	if (styleCssText.trim()) {
		sections.push('', '=== style.css (reclassify this) ===', styleCssText);
	}
	if (variationsContext) {
		sections.push(
			'',
			'=== existing block style variations ===',
			variationsContext,
		);
	}
	for (const [path, html] of Object.entries(markup)) {
		sections.push('', `=== markup: ${path} ===`, html);
	}

	const prompt = [
		'Use the standardize-theme skill. Maximize standards: fold every style.css rule that can be expressed structurally into theme.json (styles.elements / styles.blocks) or a named block style variation, rewrite the markup to drop the now-redundant classNames (or swap them for is-style-<slug>), and keep only the genuinely inexpressible rules in residual_css. Echo every rewritten template/part back under `files` using its exact relative path.',
		'',
		sections.join('\n'),
		'',
		'Respond with the JSON envelope ONLY. Begin your reply with `{` and end with `}`. No preamble, no commentary, no markdown fences.',
	].join('\n');

	onEvent({kind: 'step', message: 'Invoking standardize-theme agent…'});
	const responseText = await agentRunner(
		prompt,
		{cwd: opts.cwd, pluginPath: opts.pluginPath, signal: opts.signal},
		onEvent,
	);

	const envelope = parseStandardizeEnvelope(responseText, 'standardize-theme');

	// Persist theme.json patch (elements + blocks + custom).
	let patchTouched: string[] = [];
	if (envelope.theme_json_patch) {
		const result = await applyThemeJsonPatch(
			themeJsonPath,
			envelope.theme_json_patch,
		);
		if (result.wrote) {
			patchTouched = result.touched;
			onEvent({
				kind: 'success',
				message: `Patched theme.json (${result.touched.join(', ')})`,
			});
		}
	}

	// Persist block style variations.
	let variationsWritten = 0;
	if (envelope.block_style_variations) {
		const result = await applyBlockStyleVariations(
			themeDir,
			envelope.block_style_variations,
		);
		variationsWritten = result.written.length;
		if (variationsWritten > 0) {
			onEvent({
				kind: 'success',
				message: `Registered ${variationsWritten} block style variation${variationsWritten === 1 ? '' : 's'}`,
			});
		}
	}

	// Write the trimmed residual CSS to the auxiliary design stylesheet
	// (NOT the theme's style.css). Only when the skill returned one — never
	// silently blank the stylesheet if the pass declined to reclassify
	// (that would drop styling).
	// `residual_css` present (even an empty string) means the skill decided
	// what should remain: write it. An empty string ⇒ everything was
	// reclassified into theme.json, so the design stylesheet trims to
	// nothing — we MUST write the empty file, otherwise the full original
	// CSS we copied stays enqueued and double-applies the styles we just
	// folded in. `residual_css` ABSENT (undefined) ⇒ the skill didn't touch
	// the stylesheet, so we keep the copied original.
	let residualWritten = false;
	if (typeof envelope.residual_css === 'string') {
		const before = styleCssText.length;
		const trimmed = envelope.residual_css.trim();
		const out = trimmed
			? envelope.residual_css.endsWith('\n')
				? envelope.residual_css
				: envelope.residual_css + '\n'
			: '';
		await writeFileAtomic(join(themeDir, DESIGN_CSS_REL), out);
		residualWritten = true;
		onEvent({
			kind: 'success',
			message: trimmed
				? `Trimmed design CSS ${before} → ${out.length} bytes (residual only)`
				: 'All CSS reclassified into theme.json; emptied the design stylesheet.',
		});
	} else if (manifest.styleCssPath) {
		// The skill returned no residual_css key at all — it left the
		// stylesheet untouched. Preserve what we copied so styling survives.
		onEvent({
			kind: 'step',
			message: `No residual_css returned; keeping the copied ${DESIGN_CSS_REL} unchanged.`,
		});
	}

	// Build the final markup map (standardized where the agent rewrote it,
	// original otherwise).
	const finalMarkup: Record<string, string> = {...markup};
	let rewritten = 0;
	for (const [path, html] of Object.entries(envelope.files)) {
		if (!(path in finalMarkup)) {
			onEvent({
				kind: 'warn',
				message: `Skill returned markup for unknown path "${path}"; ignoring.`,
			});
			continue;
		}
		finalMarkup[path] = html;
		rewritten++;
	}

	// Strip non-Gutenberg HTML comments from EVERY file (rewritten or not)
	// and write the cleaned markup to disk — a deterministic guarantee that
	// stray annotation comments never reach the block parser, independent
	// of whether the agent honored the skill's strip instruction. Done for
	// all files (not just rewritten ones) so an un-rewritten original that
	// ingest copied in also gets cleaned.
	for (const [path, html] of Object.entries(finalMarkup)) {
		const cleaned = stripNonBlockComments(html);
		const out = cleaned.endsWith('\n') ? cleaned : cleaned + '\n';
		const onDisk = path.startsWith('parts/')
			? join(themeDir, 'parts', path.slice('parts/'.length))
			: join(themeDir, 'templates', path.slice('templates/'.length));
		await writeFileAtomic(onDisk, out);
		finalMarkup[path] = out;
	}

	onEvent({
		kind: 'step',
		message: `Standardized ${rewritten}/${Object.keys(markup).length} templates/parts; reclassified ${envelope.reclassified.length}, kept ${envelope.kept.length} rule${envelope.kept.length === 1 ? '' : 's'} as CSS`,
	});

	return {
		markup: finalMarkup,
		residualWritten,
		variationsWritten,
		patchTouched,
		reclassifiedCount: envelope.reclassified.length,
		keptCount: envelope.kept.length,
	};
}
