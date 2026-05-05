// Wraps WordPress Studio's CLI to spin up a local site against the
// project's wordpress/ directory, install required plugins, and activate
// the configured theme. Requires `studio` on PATH.
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {
	attachAbortSignal,
	trackChild,
} from '../../lib/process-tracker.js';
import {stripAnsi} from '../../lib/strip-ansi.js';
import type {LogEvent} from '../../lib/event-list.js';

const REQUIRED_PLUGINS = ['create-block-theme', 'safe-svg'];

export async function* createStudioSite(
	projectDir: string,
	siteName: string,
	themeSlug: string,
	signal?: AbortSignal,
): AsyncGenerator<LogEvent> {
	const wpDir = resolve(projectDir, 'wordpress');

	yield {
		kind: 'step',
		message: `studio site create --path ${wpDir} --name ${JSON.stringify(siteName)}`,
	};
	await runStudio(
		['site', 'create', '--path', wpDir, '--name', siteName],
		signal,
	);

	for (const plugin of REQUIRED_PLUGINS) {
		yield {
			kind: 'step',
			message: `studio wp plugin install ${plugin} --activate`,
		};
		await runStudio(
			['wp', 'plugin', 'install', plugin, '--activate', '--path', wpDir],
			signal,
		);
	}

	yield {
		kind: 'step',
		message: `studio wp theme activate ${themeSlug}`,
	};
	await runStudio(
		['wp', 'theme', 'activate', themeSlug, '--path', wpDir],
		signal,
	);

	yield {kind: 'step', message: `Studio site ready at ${wpDir}`};
}

function runStudio(args: string[], signal?: AbortSignal): Promise<void> {
	return new Promise((res, rej) => {
		const child = spawn('studio', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		trackChild(child);
		attachAbortSignal(child, signal);

		let stdout = '';
		let stderr = '';
		child.stdout.on('data', chunk => {
			stdout += String(chunk);
		});
		child.stderr.on('data', chunk => {
			stderr += String(chunk);
		});

		child.on('error', err => {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				rej(
					new Error(
						"`studio` CLI not found on PATH. Install WordPress Studio's CLI first.",
					),
				);
				return;
			}
			rej(err);
		});

		child.on('close', (code, sig) => {
			if (code === 0) {
				res();
				return;
			}
			if (signal?.aborted) {
				rej(new Error(`studio ${args[0] ?? ''} aborted.`));
				return;
			}
			const detail =
				stripAnsi((stderr.trim() || stdout.trim()) || '(no output)');
			rej(
				new Error(
					`studio ${args.join(' ')} exited with code ${
						code ?? `signal ${sig}`
					}: ${detail}`,
				),
			);
		});
	});
}
