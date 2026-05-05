// Downloads wordpress.org's latest release tarball and extracts it into
// projectDir/wordpress/. Refuses to overwrite a non-empty target.
import {writeFile, unlink, stat, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Buffer} from 'node:buffer';
import * as tar from 'tar';
import type {LogEvent} from '../../lib/event-list.js';

const WP_URL = 'https://wordpress.org/latest.tar.gz';

export async function* installWordPress(
	projectDir: string,
): AsyncGenerator<LogEvent> {
	const target = resolve(projectDir, 'wordpress');
	await assertNoWordPressDir(target);

	yield {kind: 'step', message: `Downloading ${WP_URL}`};
	const resp = await fetch(WP_URL);
	if (!resp.ok) {
		throw new Error(
			`Download failed: HTTP ${resp.status} ${resp.statusText}`,
		);
	}
	const buf = Buffer.from(await resp.arrayBuffer());

	const tmp = join(
		tmpdir(),
		`neptune-wp-${randomBytes(8).toString('hex')}.tar.gz`,
	);
	await writeFile(tmp, buf);

	try {
		const mb = (buf.byteLength / 1024 / 1024).toFixed(1);
		yield {kind: 'step', message: `Extracting ${mb} MB to ${projectDir}`};
		await tar.x({file: tmp, cwd: projectDir});
	} finally {
		try {
			await unlink(tmp);
		} catch {
			// best effort
		}
	}

	yield {kind: 'step', message: `WordPress installed at ${target}`};
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
