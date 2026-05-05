// Replaces wordpress/wp-content with a fresh `git clone` of the user's
// repo, then ensures plugins/ and uploads/ exist (gitignored, but the
// directories themselves are needed at runtime).
import {mkdir, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import type {LogEvent} from '../../lib/event-list.js';

export async function* cloneWpContent(
	projectDir: string,
	gitRepo: string,
): AsyncGenerator<LogEvent> {
	const wpRoot = resolve(projectDir, 'wordpress');
	const wpContent = join(wpRoot, 'wp-content');

	yield {kind: 'step', message: `Removing ${wpContent}`};
	await rm(wpContent, {recursive: true, force: true});

	yield {kind: 'step', message: `Cloning ${gitRepo} → ${wpContent}`};
	await runGitClone(gitRepo, wpContent);

	yield {kind: 'step', message: 'Ensuring plugins/ and uploads/ exist'};
	await mkdir(join(wpContent, 'plugins'), {recursive: true});
	await mkdir(join(wpContent, 'uploads'), {recursive: true});

	yield {kind: 'step', message: `Done. wp-content is at ${wpContent}`};
}

function runGitClone(repo: string, dest: string): Promise<void> {
	return new Promise((res, rej) => {
		const child = spawn('git', ['clone', '--', repo, dest], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stderr = '';
		child.stderr.on('data', chunk => {
			stderr += String(chunk);
		});
		child.on('error', err => {
			rej(err);
		});
		child.on('close', code => {
			if (code === 0) {
				res();
			} else {
				rej(
					new Error(
						`git clone exited with code ${code ?? 'null'}: ${stderr.trim()}`,
					),
				);
			}
		});
	});
}
