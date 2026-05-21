// Read helpers + type definitions for theme.json content.
//
// Build / refine / pattern agents READ theme.json themselves via the
// Read tool and WRITE it via the Write tool, freeform — see pull-writer
// Recipe 6. The host's contribution from this module is:
//   - readBlockStyleVariations: exposes the existing variations inventory
//     so the agent can reuse instead of duplicating
//   - readThemeJson: shared parse + non-object-root guard
//   - inspectLayoutWidths: post-build warning when settings.layout
//     widths are unset (the build agent can leave them blank when
//     Figma tokens don't expose body/wide widths)
//
// The skill prompts constrain the agent's edits to `styles.blocks` and
// `settings.custom` only; everything else (settings.color/typography/
// spacing/layout, customTemplates, templateParts, version) is owned by
// the variables-driven preset build (build-theme-json) and stays
// byte-for-byte across build / refine / pattern runs.
//
// Block style variations are NOT theme.json patches — they're separate
// JSON files at <theme>/styles/blocks/<slug>.json that WP 6.6+
// auto-registers at theme init (pull-writer Recipe 7).
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';

export type ThemeJsonPatch = {
	// Merged into theme.json's `styles.blocks` subtree. Anything WP
	// accepts there is fair game for the agent: structured properties
	// (color/typography/spacing/border), block-scoped CSS via .css,
	// editor-pickable variations under .variations.<name>.
	blocks?: Record<string, unknown>;
	// Merged into theme.json's `settings.custom` subtree. Free-form
	// nested key/value tree; WP exposes leaves as `--wp--custom--<path>`
	// CSS custom properties.
	custom?: Record<string, unknown>;
};

export async function readThemeJson(
	themeJsonPath: string,
): Promise<Record<string, unknown>> {
	const raw = await readFile(themeJsonPath, 'utf8');
	const parsed = JSON.parse(raw) as unknown;
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${themeJsonPath} did not parse to a JSON object.`);
	}
	return parsed as Record<string, unknown>;
}

// Reports which of `settings.layout.contentSize` / `wideSize` are
// unset (missing key, empty string, or non-string). The theme-json
// agent leaves these blank when Figma doesn't expose body / wide width
// tokens — and downstream every build/refine pass uses theme.json to
// resolve `align:"wide"` / no-align widths, so leaving them empty makes
// every page render at the browser default. Surfaced after build and
// during the e2e font pause so the user can fill them in before
// captures start landing.
export type LayoutWidthsStatus = {
	contentSizeMissing: boolean;
	wideSizeMissing: boolean;
};

export async function inspectLayoutWidths(
	themeJsonPath: string,
): Promise<LayoutWidthsStatus> {
	let theme: Record<string, unknown>;
	try {
		theme = await readThemeJson(themeJsonPath);
	} catch {
		return {contentSizeMissing: true, wideSizeMissing: true};
	}
	const settings = isPlainObject(theme['settings']) ? theme['settings'] : {};
	const layout = isPlainObject(settings['layout']) ? settings['layout'] : {};
	const isUnset = (v: unknown): boolean =>
		typeof v !== 'string' || v.trim() === '';
	return {
		contentSizeMissing: isUnset(layout['contentSize']),
		wideSizeMissing: isUnset(layout['wideSize']),
	};
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export type BlockStyleVariation = {
	// Globally unique slug for this variation. The class WP generates is
	// `is-style-<slug>`. Must be `neptune-` prefixed to avoid collision
	// with theme defaults; that constraint is enforced at parse time.
	slug: string;
	title: string;
	// One or more block names (`core/x` or `<vendor>/x`) this variation
	// applies to. WP picks the variation up in the editor's style switcher
	// for each named block.
	blockTypes: string[];
	// theme.json `styles` shape — color/typography/spacing/border/elements/
	// blocks/css. Settings, patterns, and templates are not allowed in
	// these files (WP rejects them). We forward whatever the agent emits
	// without inspecting the inner shape.
	styles: Record<string, unknown>;
};

// Lists every block style variation already shipped at
// <theme>/styles/blocks/*.json so the agent can reuse an existing
// variation instead of registering a new duplicate. Tolerant: missing
// dir returns []; malformed files are skipped (logged via onWarn).
// The returned shape mirrors `BlockStyleVariation` because that's the
// agent's working unit — slug, title, blockTypes, styles. WP-only
// metadata ($schema, version) is dropped.
export async function readBlockStyleVariations(
	themePath: string,
	onWarn?: (msg: string) => void,
): Promise<BlockStyleVariation[]> {
	const blocksDir = join(themePath, 'styles', 'blocks');
	let entries: string[];
	try {
		entries = await readdir(blocksDir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
	const out: BlockStyleVariation[] = [];
	for (const name of entries.sort()) {
		if (!name.endsWith('.json')) continue;
		const filePath = join(blocksDir, name);
		let raw: string;
		try {
			raw = await readFile(filePath, 'utf8');
		} catch (err) {
			onWarn?.(
				`Could not read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
			);
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			onWarn?.(
				`Skipping non-JSON ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
			);
			continue;
		}
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			onWarn?.(`Skipping ${filePath}: not a JSON object.`);
			continue;
		}
		const obj = parsed as Record<string, unknown>;
		const slug =
			typeof obj['slug'] === 'string' ? (obj['slug'] as string) : null;
		const title =
			typeof obj['title'] === 'string' ? (obj['title'] as string) : null;
		const blockTypes = Array.isArray(obj['blockTypes'])
			? (obj['blockTypes'] as unknown[]).filter(
					(b): b is string => typeof b === 'string',
				)
			: null;
		const styles =
			typeof obj['styles'] === 'object' &&
			obj['styles'] !== null &&
			!Array.isArray(obj['styles'])
				? (obj['styles'] as Record<string, unknown>)
				: null;
		if (!slug || !title || !blockTypes || blockTypes.length === 0 || !styles) {
			onWarn?.(`Skipping ${filePath}: missing slug/title/blockTypes/styles.`);
			continue;
		}
		out.push({slug, title, blockTypes, styles});
	}
	return out;
}

// Renders existing variations as a section the agent can read alongside
// theme.json. Returns null when the inventory is empty so callers can
// omit the section entirely instead of emitting an empty header.
export function formatBlockStyleVariationsContext(
	variations: ReadonlyArray<BlockStyleVariation>,
): string | null {
	if (variations.length === 0) return null;
	const body = variations.map(v => ({
		slug: v.slug,
		title: v.title,
		blockTypes: v.blockTypes,
		styles: v.styles,
	}));
	return JSON.stringify(body, null, '\t');
}
