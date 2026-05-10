// After a pull, code.tsx contains a header block of `const imgFoo =
// "http://localhost:3845/assets/<hash>.<ext>"` declarations — Figma's local
// asset server. We download those bytes to design/<slug>/assets/ so the
// pull is self-contained once the local server stops serving.
//
// Filtering: PNG/JPG/GIF/WEBP and SVG are kept. Each ref is tagged
// with `kind` ('raster' | 'svg') so downstream can decide what to do.
// This module only downloads and tags; it does not rasterize, triage,
// or upload. Rasters flow straight to the WP media library
// (source/integrations/studio/pull-asset-upload.ts). SVGs are flagged
// for triage; downstream (source/integrations/figma/svg-triage.ts)
// rasterizes each to PNG and runs a vision agent that classifies it
// as keep (logos, brand marks, illustrations, content icons —
// uploaded as PNG) or discard (dividers, ornaments, decorative
// gradients — deleted, with the agent's 1-sentence description
// persisted to meta.json for the build agent's structural-
// replacement choice). The split exists because Figma's code
// generator emits both real artwork AND decoration as SVG, and the
// build agent can already express decoration structurally
// (border / wp:separator / background) — uploading decoration just
// clutters the media library. The WP media library only ever
// receives rasters.
//
// Asset GETs are confirmed NOT subject to the MCP rate limit, so we don't
// guard against 429 here. Each fetch carries a per-asset timeout and the
// caller's AbortSignal is honoured.
import {Buffer} from 'node:buffer';
import {access, mkdir, readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {writeFileAtomic} from '../../lib/atomic-write.js';
import type {LogEvent} from '../../lib/event-list.js';

// Anchored to start-of-line. Captures the const name AND the URL so
// callers can map a downloaded file back to the variable that
// references it in code.tsx. If Figma switches to let/var/destructuring/
// inline JSX URLs, those won't be picked up.
const ASSET_DECL_RE =
	/^const\s+(\w+)\s*=\s*["'](http:\/\/localhost:3845\/assets\/[^"']+)["']/gm;

// Anything Figma's local asset server actually emits. Exotic formats
// outside this set (e.g. .pdf, .mp4) are dropped at parse time.
const KEEP_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const SVG_EXT_RE = /\.svg$/i;

export type AssetKind = 'raster' | 'svg';

const ASSET_TIMEOUT_MS = 30_000;
const PARALLEL_DOWNLOADS = 4;

export type AssetRef = {
	// The variable name on the left-hand side of the const declaration.
	// Becomes the join key for the WP media mapping passed to the build
	// agent.
	constName: string;
	url: string;
	filename: string;
	// Derived from the URL extension. Drives downstream branching:
	// rasters upload directly, SVGs are triaged by the value agent
	// before any upload.
	kind: AssetKind;
};

export type DownloadedAsset = AssetRef & {
	// Absolute path to the on-disk file after a successful download or
	// a cache hit. Consumers use this to stage the file into wp-content
	// for `wp media import`.
	path: string;
};

export type AssetDownloadResult = {
	downloaded: number;
	skipped: number;
	failed: number;
	// Every asset that ended up on disk (downloaded or pre-existing).
	// Excludes any that hit fetch errors. Order matches code.tsx
	// declaration order.
	assets: DownloadedAsset[];
};

export async function downloadCodeAssets(
	pullDir: string,
	onEvent?: (ev: LogEvent) => void,
	signal?: AbortSignal,
): Promise<AssetDownloadResult> {
	const codePath = join(pullDir, 'code.tsx');

	let code: string;
	try {
		code = await readFile(codePath, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return {downloaded: 0, skipped: 0, failed: 0, assets: []};
		}
		throw err;
	}

	const refs = extractAssetRefs(code);
	if (refs.length === 0) {
		return {downloaded: 0, skipped: 0, failed: 0, assets: []};
	}

	const assetsDir = join(pullDir, 'assets');
	await mkdir(assetsDir, {recursive: true});

	onEvent?.({
		kind: 'step',
		message: `Downloading ${refs.length} asset${refs.length === 1 ? '' : 's'}…`,
	});

	let downloaded = 0;
	let skipped = 0;
	let failed = 0;
	const failures: Error[] = [];
	const onDisk = new Map<string, DownloadedAsset>();

	let cursor = 0;
	const next = (): AssetRef | null => {
		if (signal?.aborted) return null;
		if (cursor >= refs.length) return null;
		return refs[cursor++]!;
	};

	const worker = async () => {
		while (true) {
			const ref = next();
			if (ref === null) return;
			const outPath = join(assetsDir, ref.filename);

			if (await fileExists(outPath)) {
				skipped++;
				onDisk.set(ref.url, {...ref, path: outPath});
				continue;
			}

			try {
				const buf = await fetchAsset(ref.url, signal);
				await writeFileAtomic(outPath, buf);
				downloaded++;
				onDisk.set(ref.url, {...ref, path: outPath});
			} catch (err) {
				failed++;
				const message = err instanceof Error ? err.message : String(err);
				failures.push(err instanceof Error ? err : new Error(message));
				onEvent?.({
					kind: 'warn',
					message: `${ref.filename}: ${message}`,
				});
			}
		}
	};

	const workers = Array.from({length: PARALLEL_DOWNLOADS}, () => worker());
	await Promise.all(workers);

	if (signal?.aborted) {
		throw new Error('Asset download aborted.');
	}

	const parts = [`${downloaded} downloaded`];
	if (skipped > 0) parts.push(`${skipped} already cached`);
	if (failed > 0) parts.push(`${failed} failed`);
	onEvent?.({kind: 'step', message: `Assets: ${parts.join(', ')}`});

	if (failed > 0) {
		throw new Error(
			`Asset download had ${failed} failure${failed === 1 ? '' : 's'}: ${
				failures[0]?.message ?? 'unknown'
			}`,
		);
	}

	// Preserve code.tsx declaration order; drop refs that failed.
	const assets = refs
		.map(r => onDisk.get(r.url))
		.filter((a): a is DownloadedAsset => a !== undefined);

	return {downloaded, skipped, failed, assets};
}

async function fetchAsset(
	url: string,
	parentSignal: AbortSignal | undefined,
): Promise<Buffer> {
	const controller = new AbortController();
	const onParentAbort = () => controller.abort();
	if (parentSignal) {
		if (parentSignal.aborted) controller.abort();
		else parentSignal.addEventListener('abort', onParentAbort, {once: true});
	}
	const timer = setTimeout(() => {
		controller.abort(
			new Error(`Asset fetch timed out after ${ASSET_TIMEOUT_MS}ms`),
		);
	}, ASSET_TIMEOUT_MS);
	try {
		const resp = await fetch(url, {signal: controller.signal});
		if (!resp.ok) {
			throw new Error(`HTTP ${resp.status}`);
		}
		return Buffer.from(await resp.arrayBuffer());
	} finally {
		clearTimeout(timer);
		if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
	}
}

// Returns one entry per (constName, url) pair whose URL path ends in a
// supported extension (png/jpg/jpeg/gif/webp/svg). Dedupes by URL,
// first occurrence wins so the constName matches the first declaration
// in code.tsx. Each ref carries `kind` so SVGs can be split off for
// triage before upload.
export function extractAssetRefs(code: string): AssetRef[] {
	const seen = new Set<string>();
	const out: AssetRef[] = [];
	for (const match of code.matchAll(ASSET_DECL_RE)) {
		const constName = match[1];
		const url = match[2];
		if (!constName || !url) continue;
		if (seen.has(url)) continue;
		const pathname = new URL(url).pathname;
		if (!KEEP_EXT_RE.test(pathname)) continue;
		seen.add(url);
		const kind: AssetKind = SVG_EXT_RE.test(pathname) ? 'svg' : 'raster';
		out.push({constName, url, filename: basename(pathname), kind});
	}
	return out;
}

// Backward-compat shim. Prefer extractAssetRefs for new code so the
// constName is preserved.
export function extractAssetUrls(code: string): string[] {
	return extractAssetRefs(code).map(r => r.url);
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}
