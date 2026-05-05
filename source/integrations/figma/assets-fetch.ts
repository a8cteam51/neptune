// After a pull, code.tsx contains a header block of `const imgFoo =
// "http://localhost:3845/assets/<hash>.<ext>"` declarations — Figma's local
// asset server. We download those bytes to design/<slug>/assets/ so the
// pull is self-contained once the local server stops serving.
//
// Asset GETs are confirmed NOT subject to the MCP rate limit, so we don't
// guard against 429 here. Each fetch carries a per-asset timeout and the
// caller's AbortSignal is honoured.
import {Buffer} from 'node:buffer';
import {access, mkdir, readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {writeFileAtomic} from '../../lib/atomic-write.js';
import type {LogEvent} from '../../lib/event-list.js';

// Anchored to start-of-line. Only matches the `const <name> = "<url>";`
// pattern Figma's code generator emits. If they switch to `let`/`var`/
// destructuring/inline JSX URLs, those won't be picked up.
const ASSET_URL_RE =
	/^const\s+\w+\s*=\s*["'](http:\/\/localhost:3845\/assets\/[^"']+)["']/gm;
const ASSET_TIMEOUT_MS = 30_000;
const PARALLEL_DOWNLOADS = 4;

export type AssetDownloadResult = {
	downloaded: number;
	skipped: number;
	failed: number;
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
	const failures: Error[] = [];

	let cursor = 0;
	const next = (): string | null => {
		if (signal?.aborted) return null;
		if (cursor >= urls.length) return null;
		return urls[cursor++]!;
	};

	const worker = async () => {
		while (true) {
			const url = next();
			if (url === null) return;
			const filename = basename(new URL(url).pathname);
			const outPath = join(assetsDir, filename);

			if (await fileExists(outPath)) {
				skipped++;
				continue;
			}

			try {
				const buf = await fetchAsset(url, signal);
				await writeFileAtomic(outPath, buf);
				downloaded++;
			} catch (err) {
				failed++;
				const message = err instanceof Error ? err.message : String(err);
				failures.push(
					err instanceof Error ? err : new Error(message),
				);
				onEvent?.({
					kind: 'warn',
					message: `${filename}: ${message}`,
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

	return {downloaded, skipped, failed};
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
		controller.abort(new Error(`Asset fetch timed out after ${ASSET_TIMEOUT_MS}ms`));
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
