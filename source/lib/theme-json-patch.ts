// Reads and merges theme.json on disk. Build/refine agents emit
// theme.json patches as part of their JSON envelope; this module deep-
// merges them into the live theme.json without disturbing anything
// outside the two allowed subtrees:
//
//   patch.blocks  →  styles.blocks
//   patch.custom  →  settings.custom
//
// Everything else in theme.json (settings.color/typography/spacing/layout,
// customTemplates, templateParts, version, ...) is the variables-driven
// preset build's territory and is preserved byte-for-byte through
// merge → write.
//
// Block style variations (the editor-pickable kind) are NOT theme.json
// patches — they're separate JSON files at <theme>/styles/blocks/<slug>.json
// that WP 6.6+ auto-registers at theme init. See applyBlockStyleVariations.
import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeFileAtomic} from './atomic-write.js';
import {wpCli} from './wp-cli.js';
import type {StudioSession} from '../integrations/studio/mcp.js';

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
	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		throw new Error(`${themeJsonPath} did not parse to a JSON object.`);
	}
	return parsed as Record<string, unknown>;
}

export async function applyThemeJsonPatch(
	themeJsonPath: string,
	patch: ThemeJsonPatch,
): Promise<{wrote: boolean; touched: string[]}> {
	const touched: string[] = [];
	if (!patch.blocks && !patch.custom) {
		return {wrote: false, touched};
	}

	const current = await readThemeJson(themeJsonPath);
	const next = structuredClone(current);

	if (patch.blocks) {
		const styles = ensureObject(next, 'styles');
		const blocks = ensureObject(styles, 'blocks');
		deepMergeInto(blocks, patch.blocks);
		touched.push('styles.blocks');
	}

	if (patch.custom) {
		const settings = ensureObject(next, 'settings');
		const custom = ensureObject(settings, 'custom');
		deepMergeInto(custom, patch.custom);
		touched.push('settings.custom');
	}

	const serialized = JSON.stringify(next, null, '\t') + '\n';
	await writeFileAtomic(themeJsonPath, serialized);
	return {wrote: true, touched};
}

// Ask WP to discard its cached resolved theme.json so the live site
// picks up changes on the next request. Studio's PHP caches the merged
// result; without a flush, the agent's edit only takes effect after a
// process restart. Same flush picks up new files under styles/blocks/.
export async function flushThemeJsonCache(
	session: StudioSession,
	nameOrPath: string,
): Promise<void> {
	await wpCli(session, nameOrPath, 'cache flush');
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

// Writes one JSON file per variation to <themePath>/styles/blocks/<slug>.json.
// WP 6.6+ auto-registers them at theme init, so the editor's style picker
// shows them immediately after a cache flush. Files are atomically written;
// callers can run this on every build/refine without losing existing
// variations (each call writes only the slugs it received — orphan files
// from removed variations stay until the user cleans them up).
export async function applyBlockStyleVariations(
	themePath: string,
	variations: ReadonlyArray<BlockStyleVariation>,
): Promise<{written: string[]}> {
	if (variations.length === 0) return {written: []};

	const blocksDir = join(themePath, 'styles', 'blocks');
	await mkdir(blocksDir, {recursive: true});

	const written: string[] = [];
	for (const v of variations) {
		const filePath = join(blocksDir, `${v.slug}.json`);
		const body =
			JSON.stringify(
				{
					$schema: 'https://schemas.wp.org/trunk/theme.json',
					version: 3,
					title: v.title,
					slug: v.slug,
					blockTypes: v.blockTypes,
					styles: v.styles,
				},
				null,
				'\t',
			) + '\n';
		await writeFileAtomic(filePath, body);
		written.push(filePath);
	}
	return {written};
}

// --- helpers -------------------------------------------------------------

function ensureObject(
	host: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const existing = host[key];
	if (
		typeof existing === 'object' &&
		existing !== null &&
		!Array.isArray(existing)
	) {
		return existing as Record<string, unknown>;
	}
	const created: Record<string, unknown> = {};
	host[key] = created;
	return created;
}

// In-place deep merge: for every key in `src`, if both sides are plain
// objects, recurse; otherwise the src value wins. Arrays and primitives
// in src replace the dest value rather than being merged element-wise —
// theme.json doesn't have any keys where array merge is the right call,
// and replace semantics keep the patch shape predictable.
export function deepMergeInto(
	dest: Record<string, unknown>,
	src: Record<string, unknown>,
): void {
	for (const [key, value] of Object.entries(src)) {
		const destValue = dest[key];
		if (isPlainObject(destValue) && isPlainObject(value)) {
			deepMergeInto(destValue, value);
		} else {
			dest[key] = value;
		}
	}
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
