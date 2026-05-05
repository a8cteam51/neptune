// Wraps WordPress Studio's CLI to spin up a local site against the
// project's wordpress/ directory, install required plugins, and activate
// the configured theme. Requires `studio` on PATH.
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import type {LogEvent} from '../../lib/event-list.js';

const REQUIRED_PLUGINS = ['create-block-theme', 'safe-svg'];

export async function* createStudioSite(
	projectDir: string,
	siteName: string,
	themeSlug: string,
): AsyncGenerator<LogEvent> {
	const wpDir = resolve(projectDir, 'wordpress');

	yield {
		kind: 'step',
		message: `studio site create --path ${wpDir} --name "${siteName}"`,
	};
	await runStudio([
		'site',
		'create',
		'--path',
		wpDir,
		'--name',
		siteName,
	]);

	for (const plugin of REQUIRED_PLUGINS) {
		yield {
			kind: 'step',
			message: `studio wp plugin install ${plugin} --activate`,
		};
		await runStudio([
			'wp',
			'plugin',
			'install',
			plugin,
			'--activate',
			'--path',
			wpDir,
		]);
	}

	yield {
		kind: 'step',
		message: `studio wp theme activate ${themeSlug}`,
	};
	await runStudio(['wp', 'theme', 'activate', themeSlug, '--path', wpDir]);

	yield {kind: 'step', message: `Studio site ready at ${wpDir}`};
}

function runStudio(args: string[]): Promise<void> {
	return new Promise((res, rej) => {
		const child = spawn('studio', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

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

		child.on('close', code => {
			if (code === 0) {
				res();
				return;
			}
			const detail = (stderr.trim() || stdout.trim()) || '(no output)';
			rej(
				new Error(
					`studio ${args.join(' ')} exited with code ${code ?? 'null'}: ${detail}`,
				),
			);
		});
	});
}
