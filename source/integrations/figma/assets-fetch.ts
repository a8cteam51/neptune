// After a pull, code.tsx contains a header block of `const imgFoo =
// "http://localhost:3845/assets/<hash>.<ext>"` declarations — Figma's local
// asset server. We download those bytes to design/<slug>/assets/ so the
// pull is self-contained once the local server stops serving.
//
// Filtering: only .png / .jpg / .jpeg are kept. SVG and other formats
// are skipped because most are decorative artifacts from Figma's code
// generator, not designer-added imagery. The build agent gets a media
// library mapping for the kept files (see source/lib/asset-mappings.ts);
// SVG references end up with empty src in the emitted markup.
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

// Designer-added imagery only. SVG/AVIF/WEBP/etc are dropped at parse
// time so we never spend an HTTP fetch on them.
const KEEP_EXT_RE = /\.(png|jpe?g)$/i;

const ASSET_TIMEOUT_MS = 30_000;
const PARALLEL_DOWNLOADS = 4;

export type AssetRef = {
	// The variable name on the left-hand side of the const declaration.
	// Becomes the join key for the WP media mapping passed to the build
	// agent.
	constName: string;
	url: string;
	filename: string;
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

// Returns one entry per (constName, url) pair where the URL's path
// ends in .png/.jpg/.jpeg. Dedupes by URL, first occurrence wins so
// the constName matches the first declaration in code.tsx.
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
		out.push({constName, url, filename: basename(pathname)});
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
