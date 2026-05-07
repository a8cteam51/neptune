// Helpers for the pattern flow. The lifecycle is:
//   1. extract-patterns scans every non-special design pull's code.tsx
//      and presents a checkbox list of unique top-level function names;
//      the user's selection persists to neptune-config (config.patterns).
//   2. pull-pattern fetches each selected pattern from Figma and writes
//      <project>/patterns/<Name>/{code.tsx, screenshot.png,
//      variables.json, metadata.xml, meta.json}.
//   3. build-patterns runs the tsx-to-pattern skill against each
//      patterns/<Name>/code.tsx and writes
//      <theme>/patterns/<kebab-slug>.php — WP core auto-registers from
//      its header comment.
//
// listRegisteredPatterns surfaces "what is currently registered" to the
// build-template / build-content agents so they can emit
// `<!-- wp:pattern {"slug":"..."} /-->` instead of duplicating a
// pattern's markup inline.
//
// Source of truth for the PHP file format:
//   https://developer.wordpress.org/themes/patterns/
import {mkdir, readdir, readFile, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {writeFileAtomic} from './atomic-write.js';
import {parseAgentJson} from './build-envelope.js';
import {
	parseBlockStyleVariationsField,
	parseThemeJsonPatchField,
} from './build-envelope.js';
import type {BlockStyleVariation, ThemeJsonPatch} from './theme-json-patch.js';

// One source pattern living under <project>/patterns/<Name>/code.tsx.
// The folder name doubles as the PascalCase function name. The sibling
// screenshot.png is fed to the build agent as visual reference;
// variables.json, metadata.xml and meta.json are written by pull-pattern
// for future verify/refine flows but aren't required to build.
export type PatternSource = {
	// PascalCase function name as written in the TSX (e.g. "HeroCallout").
	name: string;
	// Absolute path to the code.tsx file inside the pattern folder.
	path: string;
	// File contents.
	body: string;
};

// Metadata persisted by pull-pattern alongside the Figma artifacts.
// Mirrors PullMeta in shape but is patterns-specific — we deliberately
// don't reuse PullMeta because patterns have no templateFile,
// previewPath, or post-content seam.
export type PatternMeta = {
	name: string;
	selectionName?: string;
	x?: number;
	y?: number;
	pulledAt: string;
};

// Atomically writes <project>/patterns/<Name>/meta.json. Symmetric to
// design-walk.ts's writePullMeta — keeps the shape centralized so
// future readers don't have to inspect every call site to learn what
// the file contains.
export async function writePatternMeta(
	projectDir: string,
	name: string,
	meta: PatternMeta,
): Promise<void> {
	const folder = join(projectDir, 'patterns', name);
	await mkdir(folder, {recursive: true});
	await writeFileAtomic(
		join(folder, 'meta.json'),
		JSON.stringify(meta, null, 2) + '\n',
	);
}

// Lists every <project>/patterns/<Name>/code.tsx file. Returns [] when
// the patterns directory does not exist; callers can decide whether
// that's an error or a "user hasn't run extract-patterns yet" state.
// Folders without a code.tsx are skipped silently (analogous to design
// pulls that lack a meta.json).
export async function listPatternSources(
	projectDir: string,
): Promise<PatternSource[]> {
	const dir = join(projectDir, 'patterns');
	let entries: string[];
	try {
		entries = (await readdir(dir)).sort();
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
	const out: PatternSource[] = [];
	for (const name of entries) {
		if (name.startsWith('.')) continue;
		const folder = join(dir, name);
		try {
			const s = await stat(folder);
			if (!s.isDirectory()) continue;
		} catch {
			continue;
		}
		const path = join(folder, 'code.tsx');
		let body: string;
		try {
			body = await readFile(path, 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
			throw err;
		}
		out.push({name, path, body});
	}
	return out;
}

// One pattern that's both pulled (folder + code.tsx on disk) AND built
// (PHP file under <theme>/patterns/). Returned by listRegisteredPatterns
// and surfaced to the build-template / build-content agents so they
// reference the pattern instead of rebuilding its body.
export type RegisteredPattern = {
	// PascalCase function name — matches the JSX tag the agent will see
	// in code.tsx (e.g. <HeroCallout />).
	name: string;
	// The slug WordPress core registers, in <theme-slug>/<kebab> form.
	// What the agent emits as the `slug` attr on `<!-- wp:pattern -->`.
	slug: string;
};

// Discovers patterns that are currently registered in the active theme.
// A pattern counts as registered when:
//   1. patterns/<Name>/ is a directory, AND
//   2. <theme>/patterns/<kebab>.php is a file.
// Both ends are required because the agent needs the PascalCase name
// (only available from the folder) AND we need to know the PHP exists
// (otherwise WordPress hasn't auto-registered it and `wp:pattern` would
// fall back to nothing). Returns [] when either directory is missing.
export async function listRegisteredPatterns(
	projectDir: string,
	themeSlug: string,
): Promise<RegisteredPattern[]> {
	const patternsRoot = join(projectDir, 'patterns');
	let entries: string[];
	try {
		entries = (await readdir(patternsRoot)).sort();
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}

	const themePatternsDir = resolve(
		projectDir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		'patterns',
	);

	const out: RegisteredPattern[] = [];
	for (const name of entries) {
		if (name.startsWith('.')) continue;
		const folder = join(patternsRoot, name);
		try {
			const s = await stat(folder);
			if (!s.isDirectory()) continue;
		} catch {
			continue;
		}
		const kebab = kebabFromPascalCase(name);
		if (!kebab) continue;
		const phpPath = join(themePatternsDir, `${kebab}.php`);
		try {
			const s = await stat(phpPath);
			if (!s.isFile()) continue;
		} catch {
			continue;
		}
		out.push({name, slug: `${themeSlug}/${kebab}`});
	}
	return out;
}

// Renders the registered-patterns inventory for an agent prompt. Returns
// null when the inventory is empty so callers can omit the section
// entirely. JSON keeps the names + slugs unambiguous (PascalCase
// preserved verbatim — important for case-sensitive JSX matching).
export function formatRegisteredPatternsContext(
	patterns: ReadonlyArray<RegisteredPattern>,
): string | null {
	if (patterns.length === 0) return null;
	return JSON.stringify(
		patterns.map(p => ({name: p.name, slug: p.slug})),
		null,
		2,
	);
}

// PascalCase → kebab-case. "HeroCallout" → "hero-callout",
// "CTASection" → "cta-section", "Already-Kebab" → "already-kebab".
// Numbers stay attached to the preceding token unless they start a new
// word. The output is the pattern slug the PHP file is named after.
export function kebabFromPascalCase(input: string): string {
	const trimmed = input.trim();
	if (trimmed === '') return '';
	const withSeparators = trimmed
		// CTASection → CTA-Section
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
		// HeroCallout → Hero-Callout
		.replace(/([a-z\d])([A-Z])/g, '$1-$2')
		// Snake → kebab
		.replaceAll('_', '-');
	return withSeparators
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');
}

// Pattern envelope returned by the tsx-to-pattern skill. Same theme/
// variation fields as the build envelope, plus pattern-specific
// metadata that drives the PHP file header.
export type PatternEnvelope = {
	title: string;
	description?: string;
	categories?: string[];
	keywords?: string[];
	block_types?: string[];
	viewport_width?: number;
	inserter?: boolean;
	template_html: string;
	theme_json_patch?: ThemeJsonPatch;
	block_style_variations?: BlockStyleVariation[];
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// Validates the agent's JSON envelope. Reuses parseThemeJsonPatchField
// and parseBlockStyleVariationsField so the rules don't drift from the
// build/refine paths.
export function parsePatternEnvelope(
	input: string,
	label = 'tsx-to-pattern',
): PatternEnvelope {
	const parsed = parseAgentJson(input, label);
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${label} response is not a JSON object.`);
	}
	const obj = parsed as Record<string, unknown>;

	const title = obj['title'];
	if (typeof title !== 'string' || title.trim() === '') {
		throw new Error(`${label} envelope is missing a non-empty title.`);
	}
	const html = obj['template_html'];
	if (typeof html !== 'string' || !html.trim()) {
		throw new Error(`${label} envelope is missing a non-empty template_html.`);
	}

	const description = optionalString(
		obj['description'],
		`${label}.description`,
	);
	const categories = optionalSlugArray(
		obj['categories'],
		`${label}.categories`,
	);
	const keywords = optionalStringArray(obj['keywords'], `${label}.keywords`);
	const block_types = optionalStringArray(
		obj['block_types'],
		`${label}.block_types`,
	);
	const viewport_width = optionalPositiveInt(
		obj['viewport_width'],
		`${label}.viewport_width`,
	);
	const inserter = optionalBoolean(obj['inserter'], `${label}.inserter`);

	const theme_json_patch = parseThemeJsonPatchField(
		obj['theme_json_patch'],
		label,
	);
	const block_style_variations = parseBlockStyleVariationsField(
		obj['block_style_variations'],
		label,
	);

	return {
		title: title.trim(),
		description,
		categories,
		keywords,
		block_types,
		viewport_width,
		inserter,
		template_html: html,
		theme_json_patch,
		block_style_variations,
	};
}

// Renders one pattern as a PHP file. The header is a docblock comment
// WordPress core parses at boot to register the pattern. Body is
// straight block markup — no PHP execution required for static
// patterns. Format is documented at
// https://developer.wordpress.org/themes/patterns/.
export function serializePatternPhp({
	themeSlug,
	slug,
	envelope,
}: {
	themeSlug: string;
	slug: string;
	envelope: PatternEnvelope;
}): string {
	const headers: string[] = [];
	headers.push(`Title: ${envelope.title}`);
	headers.push(`Slug: ${themeSlug}/${slug}`);
	if (envelope.categories && envelope.categories.length > 0) {
		headers.push(`Categories: ${envelope.categories.join(', ')}`);
	}
	if (envelope.keywords && envelope.keywords.length > 0) {
		headers.push(`Keywords: ${envelope.keywords.join(', ')}`);
	}
	if (envelope.block_types && envelope.block_types.length > 0) {
		headers.push(`Block Types: ${envelope.block_types.join(', ')}`);
	}
	if (typeof envelope.viewport_width === 'number') {
		headers.push(`Viewport Width: ${envelope.viewport_width}`);
	}
	if (envelope.inserter === false) {
		headers.push('Inserter: no');
	}
	if (envelope.description) {
		headers.push(
			`Description: ${envelope.description.replaceAll(/\s+/g, ' ').trim()}`,
		);
	}

	const headerBlock = [
		'<?php',
		'/**',
		...headers.map(h => ` * ${h}`),
		' */',
		'?>',
	].join('\n');
	const body = envelope.template_html.endsWith('\n')
		? envelope.template_html
		: envelope.template_html + '\n';
	return `${headerBlock}\n${body}`;
}

// Atomically writes a pattern PHP file to <theme>/patterns/<slug>.php,
// creating the patterns/ directory if necessary. Returns the path so
// the UI can show it.
export async function writePatternFile(
	themePath: string,
	slug: string,
	php: string,
): Promise<string> {
	const dir = join(themePath, 'patterns');
	await mkdir(dir, {recursive: true});
	const path = join(dir, `${slug}.php`);
	await writeFileAtomic(path, php);
	return path;
}

// --- helpers -------------------------------------------------------------

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') {
		throw new Error(`${label} must be a string when present.`);
	}
	const trimmed = value.trim();
	return trimmed === '' ? undefined : trimmed;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'boolean') {
		throw new Error(`${label} must be a boolean when present.`);
	}
	return value;
}

function optionalPositiveInt(
	value: unknown,
	label: string,
): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer when present.`);
	}
	return value;
}

function optionalStringArray(
	value: unknown,
	label: string,
): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array of strings when present.`);
	}
	const out: string[] = [];
	value.forEach((entry, i) => {
		if (typeof entry !== 'string' || entry.trim() === '') {
			throw new Error(`${label}[${i}] must be a non-empty string.`);
		}
		out.push(entry.trim());
	});
	return out.length > 0 ? out : undefined;
}

function optionalSlugArray(
	value: unknown,
	label: string,
): string[] | undefined {
	const arr = optionalStringArray(value, label);
	if (!arr) return undefined;
	for (const [i, slug] of arr.entries()) {
		if (!SLUG_RE.test(slug)) {
			throw new Error(
				`${label}[${i}] "${slug}" must be kebab-case (lowercase, alphanumeric + hyphens).`,
			);
		}
	}
	return arr;
}
