// Copies a validated Claude Design package into the active theme
// directory (wordpress/wp-content/themes/<slug>/), the cloned starter
// theme that already carries functions.php + inc/class-neptune-cli.php.
// We only write the package's own surfaces (theme.json, templates/,
// parts/, style.css, assets/, patterns/) — never the starter's PHP/inc,
// which the DB-write path depends on.
//
// Runs BEFORE the standardize pass, which then overwrites the rewritten
// templates/parts, patches theme.json, and trims style.css in place.
import {copyFile, cp, mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeFileAtomic} from '../../lib/atomic-write.js';
import type {LogEvent} from '../../lib/event-list.js';
import type {LayoutWidths} from '../../commands/build-theme-json.js';
import {DESIGN_CSS_REL, type ClaudeDesignManifest} from './contract.js';

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

// Forces user-supplied widths into a parsed theme.json. Empty strings are
// left as-is on the source (don't blank a width the package already set).
function enforceWidths(
	themeJson: Record<string, unknown>,
	widths: LayoutWidths,
): void {
	if (!widths.contentSize && !widths.wideSize) return;
	const settings = ensureObject(themeJson, 'settings');
	const layout = ensureObject(settings, 'layout');
	if (widths.contentSize) layout['contentSize'] = widths.contentSize;
	if (widths.wideSize) layout['wideSize'] = widths.wideSize;
}

export type IngestResult = {
	themeJson: Record<string, unknown>;
};

// Copies the package into themeDir and returns the (widths-enforced)
// parsed theme.json for downstream steps (synthetic pulls read its wide
// width).
export async function ingestPackage(
	manifest: ClaudeDesignManifest,
	themeDir: string,
	widths: LayoutWidths,
	onEvent: (ev: LogEvent) => void,
): Promise<IngestResult> {
	await mkdir(themeDir, {recursive: true});

	// theme.json — parse, enforce widths, write formatted.
	const themeJsonRaw = await readFile(manifest.themeJsonPath, 'utf8');
	const parsed = JSON.parse(themeJsonRaw) as Record<string, unknown>;
	enforceWidths(parsed, widths);
	await writeFileAtomic(
		join(themeDir, 'theme.json'),
		JSON.stringify(parsed, null, '\t') + '\n',
	);
	onEvent({kind: 'step', message: 'Copied theme.json into the theme.'});

	// templates/ and parts/ (block markup).
	await mkdir(join(themeDir, 'templates'), {recursive: true});
	for (const file of manifest.templates) {
		await copyFile(
			join(manifest.templatesDir, file),
			join(themeDir, 'templates', file),
		);
	}
	if (manifest.parts.length > 0) {
		await mkdir(join(themeDir, 'parts'), {recursive: true});
		for (const file of manifest.parts) {
			await copyFile(
				join(manifest.partsDir, file),
				join(themeDir, 'parts', file),
			);
		}
	}
	onEvent({
		kind: 'step',
		message: `Copied ${manifest.templates.length} template${manifest.templates.length === 1 ? '' : 's'} and ${manifest.parts.length} part${manifest.parts.length === 1 ? '' : 's'}.`,
	});

	// assets/ (theme.js, fonts, images) — recursive so font subdirs survive.
	await mkdir(join(themeDir, 'assets'), {recursive: true});
	if (
		manifest.scriptAssets.length +
			manifest.imageAssets.length +
			manifest.otherAssets.length >
		0
	) {
		await cp(manifest.assetsDir, join(themeDir, 'assets'), {recursive: true});
		onEvent({kind: 'step', message: 'Copied assets/ into the theme.'});
	}

	// The package's style.css → an AUXILIARY design stylesheet, NOT the
	// theme's style.css. The theme's style.css carries the theme header
	// (Theme Name / Version / Text Domain) and any parent @import the
	// starter relies on; clobbering it would break the theme's identity.
	// The standardize pass later trims this same file to residual CSS, and
	// the enqueue block loads it. Written after the assets copy so the
	// merge can't clobber it.
	if (manifest.styleCssPath) {
		await copyFile(manifest.styleCssPath, join(themeDir, DESIGN_CSS_REL));
		onEvent({
			kind: 'step',
			message: `Copied style.css into the theme as ${DESIGN_CSS_REL}.`,
		});
	}

	// patterns/ (optional; WP auto-registers theme patterns).
	if (manifest.patternFiles.length > 0) {
		await mkdir(join(themeDir, 'patterns'), {recursive: true});
		for (const file of manifest.patternFiles) {
			await copyFile(
				join(manifest.rootDir, 'patterns', file),
				join(themeDir, 'patterns', file),
			);
		}
		onEvent({
			kind: 'step',
			message: `Copied ${manifest.patternFiles.length} pattern file${manifest.patternFiles.length === 1 ? '' : 's'}.`,
		});
	}

	return {themeJson: parsed};
}
