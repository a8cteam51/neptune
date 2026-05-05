// neptune-config.json read/write. Holds *project-level* state (theme
// slug, git repo, setup step progress, variablesBuiltAt). Does NOT hold
// per-pull state — that's on disk under design/<slug>/meta.json. See
// design-walk.ts for the rationale.
//
// Older configs may carry orphan keys (pulls, devHandoffPulledAt, etc.)
// from before the move to disk-as-truth. normalizeConfig drops them on
// read; the next write through applyUpdate strips them from the file.
import {mkdir, readdir, readFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {writeFileAtomic} from '../../lib/atomic-write.js';
import {realClock, type Clock} from '../../lib/clock.js';
import {
	CONFIG_FILENAME,
	type Loaded,
	type NeptuneConfig,
} from './types.js';

export async function loadOrInit(
	dest: string,
	now: Clock = realClock,
): Promise<Loaded> {
	const configPath = resolve(dest, CONFIG_FILENAME);

	const existing = await tryReadConfig(configPath, now);
	if (existing) {
		return {dir: dest, configPath, config: existing, mode: 'continued'};
	}

	await ensureEmptyDir(dest);
	const config = newConfig(now);
	await writeConfig(configPath, config);
	return {dir: dest, configPath, config, mode: 'created'};
}

export async function applyUpdate(
	loaded: Loaded,
	updates: Partial<NeptuneConfig>,
	now: Clock = realClock,
): Promise<Loaded> {
	const merged: NeptuneConfig = {
		...loaded.config,
		...updates,
		steps: {...loaded.config.steps, ...(updates.steps ?? {})},
		updatedAt: now(),
	};
	await writeConfig(loaded.configPath, merged);
	return {...loaded, config: merged};
}

async function tryReadConfig(
	configPath: string,
	now: Clock,
): Promise<NeptuneConfig | undefined> {
	try {
		const raw = await readFile(configPath, 'utf8');
		const parsed = JSON.parse(raw) as Partial<NeptuneConfig>;
		return normalizeConfig(parsed, now);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}
		throw new Error(
			`Found ${CONFIG_FILENAME} but could not parse it: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
}

function normalizeConfig(
	parsed: Partial<NeptuneConfig>,
	now: Clock,
): NeptuneConfig {
	const ts = now();
	return {
		version: 1,
		createdAt: parsed.createdAt ?? ts,
		updatedAt: parsed.updatedAt ?? ts,
		projectName: parsed.projectName,
		gitRepo: parsed.gitRepo,
		themeSlug: parsed.themeSlug,
		design: parsed.design ?? {pagesDir: 'design'},
		steps: {
			initialized: true,
			projectNamed: parsed.steps?.projectNamed ?? false,
			gitRepoConfigured: parsed.steps?.gitRepoConfigured ?? false,
			themeConfigured: parsed.steps?.themeConfigured ?? false,
			wordpressInstalled: parsed.steps?.wordpressInstalled ?? false,
			wpContentCloned: parsed.steps?.wpContentCloned ?? false,
			studioSiteCreated: parsed.steps?.studioSiteCreated ?? false,
		},
		variablesBuiltAt: parsed.variablesBuiltAt,
	};
}

export async function markVariablesBuilt(
	loaded: Loaded,
	now: Clock = realClock,
): Promise<Loaded> {
	return applyUpdate(loaded, {variablesBuiltAt: now()}, now);
}

function newConfig(now: Clock): NeptuneConfig {
	const ts = now();
	return {
		version: 1,
		createdAt: ts,
		updatedAt: ts,
		design: {pagesDir: 'design'},
		steps: {
			initialized: true,
			projectNamed: false,
			gitRepoConfigured: false,
			themeConfigured: false,
			wordpressInstalled: false,
			wpContentCloned: false,
			studioSiteCreated: false,
		},
	};
}

async function writeConfig(configPath: string, config: NeptuneConfig) {
	await writeFileAtomic(configPath, JSON.stringify(config, null, 2) + '\n');
}

async function ensureEmptyDir(dest: string): Promise<void> {
	let exists = false;
	let isDir = false;

	try {
		const s = await stat(dest);
		exists = true;
		isDir = s.isDirectory();
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw err;
		}
	}

	if (exists && !isDir) {
		throw new Error(`${dest} exists and is not a directory.`);
	}

	if (exists) {
		const entries = await readdir(dest);
		const meaningful = entries.filter(e => !IGNORED_DIR_ENTRIES.has(e));
		if (meaningful.length > 0) {
			throw new Error(
				`${dest} is not empty (contains: ${meaningful.join(', ')}) and has no ${CONFIG_FILENAME}; refusing to initialize.`,
			);
		}
		return;
	}

	await mkdir(dest, {recursive: true});
}

const IGNORED_DIR_ENTRIES = new Set([
	'.DS_Store',
	'.localized',
	'Thumbs.db',
	'desktop.ini',
]);
