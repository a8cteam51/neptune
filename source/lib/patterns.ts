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
