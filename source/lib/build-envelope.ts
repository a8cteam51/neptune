// Shared parsing for the JSON envelope both build agents (tsx-to-blocks)
// and the apply-diff agent emit. Build-template and build-content use
// `parseBuildEnvelope` directly; refine-template's `parseApplyEnvelope`
// reuses `parseAgentJson`, `parseThemeJsonPatchField`, and
// `parseBlockStyleVariationsField` while adding its own applied/skipped
// fields.
import type {
	BlockStyleVariation,
	ThemeJsonPatch,
} from './theme-json-patch.js';

export type BuildEnvelope = {
	template_html: string;
	theme_json_patch?: ThemeJsonPatch;
	block_style_variations?: BlockStyleVariation[];
};

const VARIATION_SLUG_RE = /^neptune-[a-z0-9][a-z0-9-]*$/;
const BLOCK_NAME_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export function parseAgentJson(input: string, label: string): unknown {
	try {
		return JSON.parse(input);
	} catch (err) {
		throw new Error(
			`${label} response was not valid JSON: ${
				err instanceof Error ? err.message : String(err)
			}\n\nFirst 500 chars: ${input.slice(0, 500)}`,
		);
	}
}

// Validates the agent's theme_json_patch field. Rejects any top-level
// key other than `blocks` / `custom`; agents must not touch presets,
// customTemplates, or templateParts (the variables-driven preset build
// owns those).
export function parseThemeJsonPatchField(
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
	const allowed = new Set(['blocks', 'custom']);
	const extra = Object.keys(obj).filter(k => !allowed.has(k));
	if (extra.length > 0) {
		throw new Error(
			`${label}.theme_json_patch may only contain keys: blocks, custom. Got extra: ${extra.join(', ')}.`,
		);
	}
	const out: ThemeJsonPatch = {};
	if (obj['blocks'] !== undefined) {
		if (
			typeof obj['blocks'] !== 'object' ||
			obj['blocks'] === null ||
			Array.isArray(obj['blocks'])
		) {
			throw new Error(`${label}.theme_json_patch.blocks must be an object.`);
		}
		out.blocks = obj['blocks'] as Record<string, unknown>;
	}
	if (obj['custom'] !== undefined) {
		if (
			typeof obj['custom'] !== 'object' ||
			obj['custom'] === null ||
			Array.isArray(obj['custom'])
		) {
			throw new Error(`${label}.theme_json_patch.custom must be an object.`);
		}
		out.custom = obj['custom'] as Record<string, unknown>;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

// Validates the agent's block_style_variations field. Returns undefined
// when absent. Each entry becomes one file at <theme>/styles/blocks/<slug>.json,
// so the slug shape, blockTypes shape, and styles object kind are all
// enforced strictly here — a malformed entry would produce a malformed
// file that WP rejects at boot.
export function parseBlockStyleVariationsField(
	value: unknown,
	label: string,
): BlockStyleVariation[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) {
		throw new Error(
			`${label}.block_style_variations must be an array when present.`,
		);
	}
	if (value.length === 0) return undefined;
	const seen = new Set<string>();
	const out: BlockStyleVariation[] = [];
	value.forEach((entry, i) => {
		const path = `${label}.block_style_variations[${i}]`;
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			throw new Error(`${path} must be an object.`);
		}
		const obj = entry as Record<string, unknown>;
		const slug = obj['slug'];
		if (typeof slug !== 'string' || !VARIATION_SLUG_RE.test(slug)) {
			throw new Error(
				`${path}.slug must be a kebab-case string starting with "neptune-".`,
			);
		}
		if (seen.has(slug)) {
			throw new Error(
				`${path}.slug "${slug}" is duplicated in the same envelope.`,
			);
		}
		seen.add(slug);
		const title = obj['title'];
		if (typeof title !== 'string' || title.trim() === '') {
			throw new Error(`${path}.title must be a non-empty string.`);
		}
		const blockTypes = obj['blockTypes'];
		if (!Array.isArray(blockTypes) || blockTypes.length === 0) {
			throw new Error(
				`${path}.blockTypes must be a non-empty array of block names.`,
			);
		}
		blockTypes.forEach((bt, j) => {
			if (typeof bt !== 'string' || !BLOCK_NAME_RE.test(bt)) {
				throw new Error(
					`${path}.blockTypes[${j}] must match <vendor>/<block-name> (e.g. "core/button").`,
				);
			}
		});
		const styles = obj['styles'];
		if (
			typeof styles !== 'object' ||
			styles === null ||
			Array.isArray(styles)
		) {
			throw new Error(`${path}.styles must be an object.`);
		}
		out.push({
			slug,
			title,
			blockTypes: blockTypes as string[],
			styles: styles as Record<string, unknown>,
		});
	});
	return out;
}

export function parseBuildEnvelope(
	input: string,
	label: string,
): BuildEnvelope {
	const parsed = parseAgentJson(input, label);
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${label} response is not a JSON object.`);
	}
	const obj = parsed as Record<string, unknown>;
	const html = obj['template_html'];
	if (typeof html !== 'string' || !html.trim()) {
		throw new Error(`${label} envelope is missing a non-empty template_html.`);
	}
	const theme_json_patch = parseThemeJsonPatchField(
		obj['theme_json_patch'],
		label,
	);
	const block_style_variations = parseBlockStyleVariationsField(
		obj['block_style_variations'],
		label,
	);
	return {template_html: html, theme_json_patch, block_style_variations};
}
