// The input contract for "Claude Design" packages. A package is a
// directory that Claude Design produced: a near-final WordPress block
// theme (a complete theme.json + block-markup templates/parts + a
// hand-written style.css) PLUS static HTML references that capture the
// intended look. Neptune ingests it, standardizes it, and refines it.
//
// IMPORTANT: the shape is discovered, never assumed. A package may carry
// any number of templates (index, single, archive, 404, page-*, …),
// any number of parts (header, footer, sidebar, …), and any number of
// top-level static references. The tomrhodes.blog package is one small
// example; this validator enumerates whatever is on disk. The only hard
// requirements are a parseable theme.json (v3) and at least one block-
// markup template.
import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';

// Where the package's design CSS lands inside the theme. We deliberately
// do NOT overwrite the theme's own style.css — that file carries the
// theme header (Theme Name / Version / Text Domain) and any parent
// @import the starter relies on. The design CSS (and the standardize
// pass's residual CSS) live in this auxiliary file, enqueued separately.
export const DESIGN_CSS_REL = 'assets/neptune-design.css';

// One ingestible Claude Design package, fully enumerated. All template /
// part / asset entries are file BASENAMES (e.g. "index.html"); join them
// against `templatesDir` / `partsDir` / `assetsDir` to read them.
export type ClaudeDesignManifest = {
	rootDir: string;
	themeJsonPath: string;
	templatesDir: string;
	partsDir: string;
	assetsDir: string;
	// Block-markup template files under templates/ (basenames).
	templates: string[];
	// Block-markup template-part files under parts/ (basenames).
	parts: string[];
	// <root>/style.css, or null when the package ships no stylesheet.
	styleCssPath: string | null;
	// Files under assets/ (basenames). Split for convenience.
	scriptAssets: string[]; // *.js
	imageAssets: string[]; // *.png/.jpg/.jpeg/.gif/.webp/.svg/.avif
	otherAssets: string[]; // everything else (fonts, etc.)
	// Map of template basename → absolute path of the top-level static
	// HTML reference that shares its name (e.g. "index.html" →
	// <root>/index.html). These drive the refine diff target. Templates
	// with no matching top-level file are absent from this map.
	staticRefs: Record<string, string>;
	// Theme block-pattern files under patterns/ (basenames), if any.
	patternFiles: string[];
	// <root>/HANDOFF.md, or null.
	handoffPath: string | null;
};

export type ValidationResult = {
	ok: boolean;
	manifest: ClaudeDesignManifest | null;
	errors: string[];
	warnings: string[];
};

const IMAGE_EXTS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.svg',
	'.avif',
]);

// A file is "block markup" when its first non-whitespace content is a
// Gutenberg block comment. We check leniently (allow a leading HTML
// comment header, which Claude Design uses to annotate templates).
export function looksLikeBlockMarkup(html: string): boolean {
	return /<!--\s*wp:/.test(html);
}

async function listFiles(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, {withFileTypes: true});
		return entries
			.filter(e => e.isFile() && !e.name.startsWith('.'))
			.map(e => e.name)
			.sort();
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
}

async function fileExists(p: string): Promise<boolean> {
	try {
		const s = await stat(p);
		return s.isFile();
	} catch {
		return false;
	}
}

function extOf(name: string): string {
	const i = name.lastIndexOf('.');
	return i === -1 ? '' : name.slice(i).toLowerCase();
}

// Validates a Claude Design package directory and returns a fully
// enumerated manifest. Never throws on a malformed package — collects
// problems into `errors` (fatal) / `warnings` (advisory) so the caller
// can show them all at once. `ok` is true only when there are no errors.
export async function validateClaudeDesignDir(
	dir: string,
): Promise<ValidationResult> {
	const errors: string[] = [];
	const warnings: string[] = [];

	const themeJsonPath = join(dir, 'theme.json');
	if (!(await fileExists(themeJsonPath))) {
		errors.push('Missing theme.json at the package root.');
	} else {
		try {
			const parsed = JSON.parse(
				await readFile(themeJsonPath, 'utf8'),
			) as unknown;
			if (
				typeof parsed !== 'object' ||
				parsed === null ||
				Array.isArray(parsed)
			) {
				errors.push('theme.json did not parse to a JSON object.');
			} else {
				const o = parsed as Record<string, unknown>;
				if (o['version'] !== 3) {
					// v2 packages are coercible but flag it — schema drift can
					// surprise the standardize pass.
					warnings.push(
						`theme.json version is ${JSON.stringify(o['version'])}; expected 3. Proceeding, but verify the result.`,
					);
				}
				if (typeof o['settings'] !== 'object' || o['settings'] === null) {
					errors.push('theme.json has no "settings" object.');
				}
			}
		} catch (err) {
			errors.push(
				`theme.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	const templatesDir = join(dir, 'templates');
	const partsDir = join(dir, 'parts');
	const assetsDir = join(dir, 'assets');

	const allTemplates = (await listFiles(templatesDir)).filter(
		n => extOf(n) === '.html',
	);
	const templates: string[] = [];
	for (const name of allTemplates) {
		const html = await readFile(join(templatesDir, name), 'utf8');
		if (looksLikeBlockMarkup(html)) {
			templates.push(name);
		} else {
			warnings.push(
				`templates/${name} does not contain Gutenberg block markup (no "<!-- wp:"); skipping it.`,
			);
		}
	}
	if (templates.length === 0) {
		errors.push(
			'No block-markup templates found under templates/. At least one is required.',
		);
	}

	const allParts = (await listFiles(partsDir)).filter(
		n => extOf(n) === '.html',
	);
	const parts: string[] = [];
	for (const name of allParts) {
		const html = await readFile(join(partsDir, name), 'utf8');
		if (looksLikeBlockMarkup(html)) {
			parts.push(name);
		} else {
			warnings.push(
				`parts/${name} does not contain Gutenberg block markup; skipping it.`,
			);
		}
	}

	const styleCssPath = join(dir, 'style.css');
	const hasStyleCss = await fileExists(styleCssPath);
	if (!hasStyleCss) {
		warnings.push(
			'No style.css at the package root. Standardization will have nothing to reclassify; the theme.json must already carry all styling.',
		);
	}

	const assetNames = await listFiles(assetsDir);
	const scriptAssets = assetNames.filter(n => extOf(n) === '.js');
	const imageAssets = assetNames.filter(n => IMAGE_EXTS.has(extOf(n)));
	const otherAssets = assetNames.filter(
		n => extOf(n) !== '.js' && !IMAGE_EXTS.has(extOf(n)),
	);

	// Top-level *.html files are static references. Map each one whose
	// basename matches a template basename (e.g. <root>/index.html ↔
	// templates/index.html) so the refine loop can diff against it.
	const rootHtml = (await listFiles(dir)).filter(n => extOf(n) === '.html');
	const templateBaseNames = new Set(templates.map(t => t));
	const staticRefs: Record<string, string> = {};
	for (const name of rootHtml) {
		if (templateBaseNames.has(name)) {
			staticRefs[name] = join(dir, name);
		}
	}
	for (const t of templates) {
		if (!staticRefs[t]) {
			warnings.push(
				`templates/${t} has no matching top-level ${t} static reference; it will be installed but cannot be visually refined.`,
			);
		}
	}

	const patternFiles = (await listFiles(join(dir, 'patterns'))).filter(n => {
		const e = extOf(n);
		return e === '.php' || e === '.html';
	});

	const handoff = join(dir, 'HANDOFF.md');
	const handoffPath = (await fileExists(handoff)) ? handoff : null;

	const manifest: ClaudeDesignManifest = {
		rootDir: dir,
		themeJsonPath,
		templatesDir,
		partsDir,
		assetsDir,
		templates,
		parts,
		styleCssPath: hasStyleCss ? styleCssPath : null,
		scriptAssets,
		imageAssets,
		otherAssets,
		staticRefs,
		patternFiles,
		handoffPath,
	};

	return {
		ok: errors.length === 0,
		manifest: errors.length === 0 ? manifest : null,
		errors,
		warnings,
	};
}

// Derives the WordPress wp_template / wp_template_part target for a file,
// keyed off which source directory it came from (NOT a filename
// heuristic — a part can be named anything, e.g. "sidebar.html"). The
// slug is the basename without .html.
export type TemplateKind = 'template' | 'part';

export function targetFor(
	kind: TemplateKind,
	file: string,
): {slug: string; type: 'wp_template' | 'wp_template_part'; title: string} {
	const slug = file.replace(/\.html$/i, '');
	if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
		throw new Error(`File ${file} does not produce a valid slug.`);
	}
	const title = slug
		.split(/[-_]/u)
		.filter(p => p.length > 0)
		.map(p => p.charAt(0).toUpperCase() + p.slice(1))
		.join(' ');
	return {
		slug,
		type: kind === 'part' ? 'wp_template_part' : 'wp_template',
		title,
	};
}

// Best-effort preview URL path for a template slug, used as the refine
// diff target. WordPress resolves different templates at different URLs;
// we know the common ones and fall back to '/' (the home/index render)
// for anything else, flagging it so the user can correct the path.
//
// Returns { path, known } — `known: false` means the caller should warn
// that the diff may target the wrong page until previewPath is adjusted.
export function previewPathForTemplate(slug: string): {
	path: string;
	known: boolean;
} {
	const s = slug.toLowerCase();
	if (s === 'index' || s === 'home' || s === 'front-page') {
		return {path: '/', known: true};
	}
	if (s === 'single' || s === 'singular') {
		// The seed "Hello World" post (id 1) is always present.
		return {path: '/?p=1', known: true};
	}
	if (s === 'page') {
		// The seed "Sample Page" is id 2 on a fresh install.
		return {path: '/?page_id=2', known: true};
	}
	if (s === 'search') {
		return {path: '/?s=the', known: true};
	}
	if (s === '404') {
		return {path: '/neptune-404-probe-' + slug, known: true};
	}
	return {path: '/', known: false};
}
