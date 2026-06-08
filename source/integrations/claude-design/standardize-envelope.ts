// Parses the JSON envelope the `standardize-theme` skill emits. It is
// shaped to reuse the Figma envelope validators (parseAgentJson,
// parseBlockStyleVariationsField) verbatim, but differs in two ways that
// warrant its own parser rather than loosening the shared one:
//
//   1. It carries a `files` map (path → rewritten block markup) instead
//      of a single `template_html`, because one standardize call rewrites
//      every template/part at once.
//   2. Its `theme_json_patch` may include `elements` (per-element styling
//      folded out of style.css). The Figma parser deliberately rejects
//      `elements` — there the variables-driven theme.json build owns it.
import {
	parseAgentJson,
	parseBlockStyleVariationsField,
} from '../../lib/build-envelope.js';
import type {
	BlockStyleVariation,
	ThemeJsonPatch,
} from '../../lib/theme-json-patch.js';
import {looksLikeBlockMarkup} from './contract.js';

export type StandardizeEnvelope = {
	// Rewritten block markup keyed by the SAME relative path the caller
	// sent (e.g. "templates/index.html", "parts/footer.html"). May be
	// empty when the pass changed no markup (pure CSS reclassification).
	files: Record<string, string>;
	theme_json_patch?: ThemeJsonPatch;
	block_style_variations?: BlockStyleVariation[];
	// The trimmed style.css: only rules that cannot be expressed in
	// theme.json (dark-mode [data-theme], CSS counters, pseudo/descendant
	// selectors). Empty/absent ⇒ no stylesheet needed.
	residual_css?: string;
	// Human-readable reporting (not persisted to WP). Free-form objects.
	reclassified: Array<Record<string, unknown>>;
	kept: Array<Record<string, unknown>>;
};

// Like parseThemeJsonPatchField but ALSO permits `elements`. Mirrors its
// strictness otherwise: rejects unknown top-level keys, and rejects a
// `variations` key nested under blocks.<x> (those belong in
// block_style_variations[]).
function parseStandardizePatch(
	value: unknown,
	label: string,
): ThemeJsonPatch | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(
			`${label}.theme_json_patch must be a JSON object when present.`,
		);
	}
	const obj = value as Record<string, unknown>;
	const allowed = new Set(['blocks', 'elements', 'custom']);
	const extra = Object.keys(obj).filter(k => !allowed.has(k));
	if (extra.length > 0) {
		throw new Error(
			`${label}.theme_json_patch may only contain keys: blocks, elements, custom. Got extra: ${extra.join(', ')}.`,
		);
	}
	const out: ThemeJsonPatch = {};
	for (const key of ['blocks', 'elements', 'custom'] as const) {
		const sub = obj[key];
		if (sub === undefined) continue;
		if (typeof sub !== 'object' || sub === null || Array.isArray(sub)) {
			throw new Error(`${label}.theme_json_patch.${key} must be an object.`);
		}
		if (key === 'blocks') {
			for (const [blockName, blockBody] of Object.entries(
				sub as Record<string, unknown>,
			)) {
				if (
					typeof blockBody === 'object' &&
					blockBody !== null &&
					!Array.isArray(blockBody) &&
					'variations' in blockBody
				) {
					throw new Error(
						`${label}.theme_json_patch.blocks["${blockName}"].variations is not supported. Use block_style_variations[] instead.`,
					);
				}
			}
		}
		out[key] = sub as Record<string, unknown>;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function parseFilesField(
	value: unknown,
	label: string,
): Record<string, string> {
	if (value === undefined || value === null) return {};
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label}.files must be an object of path → block markup.`);
	}
	const out: Record<string, string> = {};
	for (const [path, html] of Object.entries(value as Record<string, unknown>)) {
		if (typeof html !== 'string' || html.trim() === '') {
			throw new Error(`${label}.files["${path}"] must be a non-empty string.`);
		}
		if (!looksLikeBlockMarkup(html)) {
			throw new Error(
				`${label}.files["${path}"] does not contain Gutenberg block markup (no "<!-- wp:").`,
			);
		}
		out[path] = html;
	}
	return out;
}

function parseReportArray(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(e): e is Record<string, unknown> =>
			typeof e === 'object' && e !== null && !Array.isArray(e),
	);
}

export function parseStandardizeEnvelope(
	input: string,
	label: string,
): StandardizeEnvelope {
	const parsed = parseAgentJson(input, label);
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${label} response is not a JSON object.`);
	}
	const obj = parsed as Record<string, unknown>;
	const files = parseFilesField(obj['files'], label);
	const theme_json_patch = parseStandardizePatch(
		obj['theme_json_patch'],
		label,
	);
	const block_style_variations = parseBlockStyleVariationsField(
		obj['block_style_variations'],
		label,
	);
	const residual =
		typeof obj['residual_css'] === 'string'
			? (obj['residual_css'] as string)
			: undefined;
	return {
		files,
		theme_json_patch,
		block_style_variations,
		residual_css: residual,
		reclassified: parseReportArray(obj['reclassified']),
		kept: parseReportArray(obj['kept']),
	};
}
