// Downloads wordpress.org's latest release tarball and extracts it into
// projectDir/wordpress/. Streams the body to disk to avoid buffering ~25
// MB in memory. Refuses to overwrite a non-empty target.
import {createWriteStream} from 'node:fs';
import {readdir, rename, stat, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import * as tar from 'tar';
import type {LogEvent} from '../../lib/event-list.js';

const WP_URL = 'https://wordpress.org/latest.tar.gz';

export async function* installWordPress(
	projectDir: string,
	signal?: AbortSignal,
): AsyncGenerator<LogEvent> {
	const target = resolve(projectDir, 'wordpress');
	await assertNoWordPressDir(target);

	yield {kind: 'step', message: `Downloading ${WP_URL}`};
	const resp = await fetch(WP_URL, {signal});
	if (!resp.ok) {
		throw new Error(`Download failed: HTTP ${resp.status} ${resp.statusText}`);
	}
	if (!resp.body) {
		throw new Error('Download returned empty body.');
	}

	const tmpStem = `neptune-wp-${randomBytes(8).toString('hex')}.tar.gz`;
	const tmpInProgress = join(tmpdir(), tmpStem + '.part');
	const tmpFinal = join(tmpdir(), tmpStem);
	const out = createWriteStream(tmpInProgress);
	try {
		await pipeline(Readable.fromWeb(resp.body as any), out, {signal});
		await rename(tmpInProgress, tmpFinal);
	} catch (err) {
		await tryUnlink(tmpInProgress);
		throw err;
	}

	try {
		yield {kind: 'step', message: `Extracting ${tmpFinal} to ${projectDir}`};
		await tar.x({
			file: tmpFinal,
			cwd: projectDir,
			strict: true,
			filter: entry => !entry.includes('..') && !entry.startsWith('/'),
		});
	} finally {
		await tryUnlink(tmpFinal);
	}

	yield {kind: 'step', message: `WordPress installed at ${target}`};
}

async function tryUnlink(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch {
		/* best effort */
	}
}

async function assertNoWordPressDir(target: string): Promise<void> {
	let s;
	try {
		s = await stat(target);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw err;
	}
	if (!s.isDirectory()) {
		throw new Error(`${target} exists and is not a directory.`);
	}
	const entries = await readdir(target);
	if (entries.length > 0) {
		throw new Error(
			`${target} already exists and is non-empty. Remove it and retry.`,
		);
	}
}
