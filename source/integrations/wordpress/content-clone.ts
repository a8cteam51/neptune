// Replaces wordpress/wp-content with a fresh `git clone` of the user's
// repo, then ensures plugins/ and uploads/ exist (gitignored, but the
// directories themselves are needed at runtime).
//
// Clone goes into a sibling temp dir first; only after success do we
// remove the existing wp-content and rename the temp into place. That
// way a failed clone (auth, network, signal abort) doesn't destroy the
// user's existing content.
import {mkdir, rename, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {attachAbortSignal, trackChild} from '../../lib/process-tracker.js';
import {defaultSpawn, type Spawn} from '../../lib/spawn.js';
import {redactUrlCredentials, stripAnsi} from '../../lib/strip-ansi.js';
import type {LogEvent} from '../../lib/event-list.js';

export type CloneOptions = {
	signal?: AbortSignal;
	spawn?: Spawn;
};

export async function* cloneWpContent(
	projectDir: string,
	gitRepo: string,
	options: CloneOptions = {},
): AsyncGenerator<LogEvent> {
	const {signal, spawn = defaultSpawn} = options;
	const wpRoot = resolve(projectDir, 'wordpress');
	const wpContent = join(wpRoot, 'wp-content');
	const stagingDir = join(
		wpRoot,
		`.wp-content.staging-${randomBytes(6).toString('hex')}`,
	);

	await mkdir(wpRoot, {recursive: true});

	yield {kind: 'step', message: `Cloning ${gitRepo} → ${stagingDir}`};
	try {
		await runGitClone(gitRepo, stagingDir, signal, spawn);
	} catch (err) {
		await rm(stagingDir, {recursive: true, force: true});
		throw err;
	}

	yield {kind: 'step', message: 'Swapping wp-content into place'};
	await rm(wpContent, {recursive: true, force: true});
	try {
		await rename(stagingDir, wpContent);
	} catch (err) {
		await rm(stagingDir, {recursive: true, force: true});
		throw err;
	}

	yield {kind: 'step', message: 'Ensuring plugins/ and uploads/ exist'};
	await mkdir(join(wpContent, 'plugins'), {recursive: true});
	await mkdir(join(wpContent, 'uploads'), {recursive: true});

	yield {kind: 'step', message: `Done. wp-content is at ${wpContent}`};
}

function runGitClone(
	repo: string,
	dest: string,
	signal: AbortSignal | undefined,
	spawn: Spawn,
): Promise<void> {
	return new Promise((res, rej) => {
		const child = spawn('git', ['clone', '--', repo, dest], {
			stdio: ['ignore', 'ignore', 'pipe'],
		});
		trackChild(child);
		attachAbortSignal(child, signal);

		let stderr = '';
		child.stderr?.on('data', chunk => {
			stderr += String(chunk);
		});
		child.on('error', err => {
			rej(err);
		});
		child.on('close', (code, sig) => {
			if (code === 0) {
				res();
				return;
			}
			if (signal?.aborted) {
				rej(new Error('git clone aborted.'));
				return;
			}
			const detail = redactUrlCredentials(stripAnsi(stderr.trim()));
			rej(
				new Error(
					`git clone exited with code ${code ?? `signal ${sig}`}: ${
						detail || '(no output)'
					}`,
				),
			);
		});
	});
}
