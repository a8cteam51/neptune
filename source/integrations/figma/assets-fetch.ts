// After a pull, code.tsx contains a header block of `const imgFoo =
// "http://localhost:3845/assets/<hash>.<ext>"` declarations — Figma's local
// asset server. We download those bytes to design/<slug>/assets/ so the
// pull is self-contained once the local server stops serving.
//
// Asset GETs are confirmed NOT subject to the MCP rate limit, so we don't
// guard against 429 here.
import {Buffer} from 'node:buffer';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import type {LogEvent} from '../../lib/event-list.js';

// Anchored to start-of-line. Only matches the `const <name> = "<url>";`
// pattern Figma's code generator emits. If they switch to `let`/`var`/
// destructuring/inline JSX URLs, those won't be picked up.
const ASSET_URL_RE =
	/^const\s+\w+\s*=\s*["'](http:\/\/localhost:3845\/assets\/[^"']+)["']/gm;

export type AssetDownloadResult = {
	downloaded: number;
	skipped: number;
	failed: number;
};

export async function downloadCodeAssets(
	pullDir: string,
	onEvent?: (ev: LogEvent) => void,
): Promise<AssetDownloadResult> {
	const codePath = join(pullDir, 'code.tsx');

	let code: string;
	try {
		code = await readFile(codePath, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return {downloaded: 0, skipped: 0, failed: 0};
		}
		throw err;
	}

	const urls = extractAssetUrls(code);
	if (urls.length === 0) return {downloaded: 0, skipped: 0, failed: 0};

	const assetsDir = join(pullDir, 'assets');
	await mkdir(assetsDir, {recursive: true});

	onEvent?.({
		kind: 'step',
		message: `Downloading ${urls.length} asset${
			urls.length === 1 ? '' : 's'
		}…`,
	});

	let downloaded = 0;
	let skipped = 0;
	let failed = 0;

	for (const url of urls) {
		const filename = basename(new URL(url).pathname);
		const outPath = join(assetsDir, filename);

		if (await fileExists(outPath)) {
			skipped++;
			continue;
		}

		try {
			const resp = await fetch(url);
			if (!resp.ok) {
				onEvent?.({
					kind: 'warn',
					message: `${filename}: HTTP ${resp.status}`,
				});
				failed++;
				continue;
			}
			const buf = Buffer.from(await resp.arrayBuffer());
			await writeFile(outPath, buf);
			downloaded++;
		} catch (err) {
			onEvent?.({
				kind: 'warn',
				message: `${filename}: ${
					err instanceof Error ? err.message : String(err)
				}`,
			});
			failed++;
		}
	}

	const parts = [`${downloaded} downloaded`];
	if (skipped > 0) parts.push(`${skipped} already cached`);
	if (failed > 0) parts.push(`${failed} failed`);
	onEvent?.({kind: 'step', message: `Assets: ${parts.join(', ')}`});

	return {downloaded, skipped, failed};
}

export function extractAssetUrls(code: string): string[] {
	const urls = new Set<string>();
	for (const match of code.matchAll(ASSET_URL_RE)) {
		const url = match[1];
		if (url) urls.add(url);
	}
	return [...urls];
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}
