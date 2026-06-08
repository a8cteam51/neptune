// Imports any image the templates/parts reference from the package's
// assets/ directory into the WordPress media library, then rewrites those
// references to the returned attachment URL. Block themes can't serve a
// raw assets/foo.png as post content reliably; media-library items get a
// stable uploads URL and an attachment id.
//
// Reuses the Figma media-import path verbatim (importMediaFile stages
// into uploads/, runs `wp media import`, returns {id,url}). Most Claude
// Design packages reference imagery via post-featured-images supplied at
// content time, so this is frequently a no-op — but a package that ships
// a logo/illustration in assets/ needs it.
import {join} from 'node:path';
import {importMediaFile} from '../studio/media-import.js';
import type {StudioSession} from '../studio/mcp.js';
import type {LogEvent} from '../../lib/event-list.js';
import type {ClaudeDesignManifest} from './contract.js';

// Replaces every `assets/<file>` reference (with any number of leading
// `../`) in a string with `replacement`. Used to swap a packaged image
// path for its media-library URL across all markup.
function rewriteRef(text: string, file: string, replacement: string): string {
	const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// The trailing `(?![\w.-])` boundary stops a filename that is a prefix
	// of another from matching inside it (e.g. `icon.svg` must not match
	// within `assets/icon.svg.png`). References live in HTML attributes, so
	// the next char after a real match is a quote/space/paren, never a
	// filename char.
	const re = new RegExp('(?:\\.\\./)*assets/' + escaped + '(?![\\w.-])', 'g');
	return text.replace(re, replacement);
}

export async function importThemeAssets(
	session: StudioSession,
	wpRoot: string,
	manifest: ClaudeDesignManifest,
	markup: Record<string, string>,
	onEvent: (ev: LogEvent) => void,
): Promise<Record<string, string>> {
	if (manifest.imageAssets.length === 0) return markup;

	// Only import images actually referenced by the markup.
	const referenced = manifest.imageAssets.filter(file =>
		Object.values(markup).some(html => html.includes(`assets/${file}`)),
	);
	if (referenced.length === 0) {
		onEvent({
			kind: 'step',
			message: `No image assets referenced by templates; skipping media import.`,
		});
		return markup;
	}

	const out: Record<string, string> = {...markup};
	for (const file of referenced) {
		try {
			const sourceAbs = join(manifest.assetsDir, file);
			const {id, url} = await importMediaFile(session, wpRoot, sourceAbs);
			for (const path of Object.keys(out)) {
				out[path] = rewriteRef(out[path]!, file, url);
			}
			onEvent({
				kind: 'success',
				message: `Imported assets/${file} → media id ${id}`,
			});
		} catch (err) {
			// Per-file failures are warnings, not fatal — the rest of the
			// import should still complete.
			onEvent({
				kind: 'warn',
				message: `Could not import assets/${file}: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}
	return out;
}
