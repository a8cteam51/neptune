// Wraps WordPress Studio's CLI to spin up a local site against the
// project's wordpress/ directory, install required plugins, and activate
// the configured theme. Requires `studio` on PATH.
import {resolve} from 'node:path';
import {attachAbortSignal, trackChild} from '../../lib/process-tracker.js';
import {defaultSpawn, type Spawn} from '../../lib/spawn.js';
import {stripAnsi} from '../../lib/strip-ansi.js';
import type {LogEvent} from '../../lib/event-list.js';

// `source` is whatever `wp plugin install` accepts: a wordpress.org
// slug, an http(s) URL to a .zip, or a local path. `label` is what we
// print in the step log so URLs don't bloat the timeline.
type RequiredPlugin = {label: string; source: string};

const REQUIRED_PLUGINS: RequiredPlugin[] = [
	{label: 'create-block-theme', source: 'create-block-theme'},
	{label: 'safe-svg', source: 'safe-svg'},
	{label: 'jetpack', source: 'jetpack'},
	// Haydi ships as a GitHub release asset, not on wordpress.org.
	// GitHub's /releases/latest/download/<asset> URL always redirects
	// to the newest tagged release's asset, so wp-cli (which follows
	// redirects) picks up the current version with no version pinning
	// to maintain on our side.
	{
		label: 'haydi-full-extensions',
		source:
			'https://github.com/Automattic/haydi/releases/latest/download/haydi-full-extensions.zip',
	},
];

// Jetpack modules to enable post-activation. Both work without a
// WordPress.com connection on local Studio sites — `blocks` ships
// Jetpack's Gutenberg blocks and `contact-form` ships the Forms block.
// Failures here are treated as warnings rather than fatal: Jetpack's
// activation hooks occasionally hit transient errors on first run,
// and the rest of the site setup shouldn't be blocked by an optional
// module.
const JETPACK_MODULES = ['blocks', 'contact-form'];

export type StudioSiteOptions = {
	signal?: AbortSignal;
	spawn?: Spawn;
};

export async function* createStudioSite(
	projectDir: string,
	siteName: string,
	themeSlug: string,
	options: StudioSiteOptions = {},
): AsyncGenerator<LogEvent> {
	const {signal, spawn = defaultSpawn} = options;
	const wpDir = resolve(projectDir, 'wordpress');

	yield {
		kind: 'step',
		message: `studio site create --path ${wpDir} --name ${JSON.stringify(siteName)}`,
	};
	await runStudio(
		['site', 'create', '--path', wpDir, '--name', siteName],
		signal,
		spawn,
	);

	for (const plugin of REQUIRED_PLUGINS) {
		yield {
			kind: 'step',
			message: `studio wp plugin install ${plugin.label} --activate`,
		};
		await runStudio(
			['wp', 'plugin', 'install', plugin.source, '--activate', '--path', wpDir],
			signal,
			spawn,
		);
	}

	for (const module of JETPACK_MODULES) {
		yield {
			kind: 'step',
			message: `studio wp jetpack module activate ${module}`,
		};
		try {
			await runStudio(
				['wp', 'jetpack', 'module', 'activate', module, '--path', wpDir],
				signal,
				spawn,
			);
		} catch (err) {
			if (signal?.aborted) throw err;
			yield {
				kind: 'warn',
				message: `Jetpack module "${module}" did not activate: ${
					err instanceof Error ? err.message : String(err)
				}. Continuing — enable it manually from the WP admin if needed.`,
			};
		}
	}

	yield {
		kind: 'step',
		message: `studio wp theme activate ${themeSlug}`,
	};
	await runStudio(
		['wp', 'theme', 'activate', themeSlug, '--path', wpDir],
		signal,
		spawn,
	);

	yield {kind: 'step', message: `Studio site ready at ${wpDir}`};
}

// Run a `studio ...` command and return the captured stdout/stderr on
// success. Throws on non-zero exit, missing binary, or abort. The CLI
// mixes ANSI spinner cruft with eventual JSON; we keep raw bytes here
// and let callers feed them through parseStudioJson.
function runStudioCommand(
	args: string[],
	signal: AbortSignal | undefined,
	spawn: Spawn,
): Promise<{stdout: string; stderr: string}> {
	return new Promise((res, rej) => {
		const child = spawn('studio', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		trackChild(child);
		attachAbortSignal(child, signal);

		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', chunk => {
			stdout += String(chunk);
		});
		child.stderr?.on('data', chunk => {
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
				res({stdout, stderr});
				return;
			}
			if (signal?.aborted) {
				rej(new Error(`studio ${args[0] ?? ''} aborted.`));
				return;
			}
			const detail = stripAnsi(stderr.trim() || stdout.trim() || '(no output)');
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

async function runStudio(
	args: string[],
	signal: AbortSignal | undefined,
	spawn: Spawn,
): Promise<void> {
	await runStudioCommand(args, signal, spawn);
}

async function runStudioCapture(
	args: string[],
	signal: AbortSignal | undefined,
	spawn: Spawn,
): Promise<string> {
	const {stdout} = await runStudioCommand(args, signal, spawn);
	return stdout;
}

// Studio's CLI prints ANSI spinner output on stdout before the
// machine-readable JSON. After stripping escape codes, the JSON is
// either an object or array starting on its own line; we slice from
// the first such start to end-of-string and parse.
export function parseStudioJson(out: string): unknown {
	const cleaned = stripAnsi(out);
	const match = /^\s*([\[{])/m.exec(cleaned);
	if (!match) {
		throw new Error(
			`Could not locate JSON in studio output: ${cleaned.slice(0, 200)}`,
		);
	}
	const startIdx = match.index + match[0].indexOf(match[1]!);
	return JSON.parse(cleaned.slice(startIdx));
}

// Fields we read from `studio site list --format=json`. Other keys
// (admin credentials, autoStart, etc.) are present but irrelevant here.
export type StudioSiteEntry = {
	id: string;
	name: string;
	path: string;
	port: number;
	url: string;
	running: boolean;
};

export type StudioListOptions = {
	signal?: AbortSignal;
	spawn?: Spawn;
};

export async function listStudioSites(
	options: StudioListOptions = {},
): Promise<StudioSiteEntry[]> {
	const {signal, spawn = defaultSpawn} = options;
	const out = await runStudioCapture(
		['site', 'list', '--format=json'],
		signal,
		spawn,
	);
	const parsed = parseStudioJson(out);
	if (!Array.isArray(parsed)) {
		throw new Error('studio site list did not return a JSON array.');
	}
	return parsed
		.filter(
			(s): s is StudioSiteEntry =>
				typeof s === 'object' &&
				s !== null &&
				typeof (s as StudioSiteEntry).path === 'string' &&
				typeof (s as StudioSiteEntry).url === 'string',
		)
		.map(s => ({
			id: s.id,
			name: s.name,
			path: s.path,
			port: s.port,
			url: s.url,
			running: s.running === true,
		}));
}

export async function findProjectSite(
	projectDir: string,
	options: StudioListOptions = {},
): Promise<StudioSiteEntry | null> {
	const wpRoot = resolve(projectDir, 'wordpress');
	const sites = await listStudioSites(options);
	return sites.find(s => resolve(s.path) === wpRoot) ?? null;
}

export type SiteStatus =
	| {state: 'running'; url: string}
	| {state: 'stopped'; url: string}
	| {state: 'unknown'; reason: string};

export async function getStudioSiteStatus(
	projectDir: string,
	options: StudioListOptions = {},
): Promise<SiteStatus> {
	let site: StudioSiteEntry | null;
	try {
		site = await findProjectSite(projectDir, options);
	} catch (err) {
		return {
			state: 'unknown',
			reason: err instanceof Error ? err.message : String(err),
		};
	}
	if (!site) {
		return {
			state: 'unknown',
			reason:
				'No site registered with Studio for this project. Open Studio and create or attach a site at wordpress/.',
		};
	}
	return site.running
		? {state: 'running', url: site.url}
		: {state: 'stopped', url: site.url};
}

export async function getSiteUrl(
	projectDir: string,
	options: StudioListOptions = {},
): Promise<string | null> {
	const site = await findProjectSite(projectDir, options);
	return site?.url ?? null;
}
