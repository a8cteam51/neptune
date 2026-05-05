// Source of truth for "what has been pulled". Each pull lives in
// design/<slug>/ and carries a meta.json describing it. We deliberately do
// NOT store this in neptune-config.json — config flags can drift from disk
// state (e.g. user deletes design/dev-handoff/ but config says it's pulled).
import {mkdir, readdir, readFile, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {writeFileAtomic} from './atomic-write.js';
import type {PullMeta, SpecialPullKind} from './types.js';

const DESIGN_DIRNAME = 'design';

export async function listPulls(projectDir: string): Promise<PullMeta[]> {
	const designDir = join(projectDir, DESIGN_DIRNAME);
	let entries: string[];
	try {
		entries = (await readdir(designDir)).sort();
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}

	const pulls: PullMeta[] = [];
	for (const slug of entries) {
		if (slug.startsWith('.')) continue;
		const metaPath = join(designDir, slug, 'meta.json');
		try {
			const s = await stat(metaPath);
			if (!s.isFile()) continue;
			const raw = await readFile(metaPath, 'utf8');
			pulls.push(JSON.parse(raw) as PullMeta);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
			throw new Error(
				`Could not read ${metaPath}: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}
	return pulls;
}

export async function findPullBySlug(
	projectDir: string,
	slug: string,
): Promise<PullMeta | null> {
	const metaPath = join(projectDir, DESIGN_DIRNAME, slug, 'meta.json');
	try {
		const raw = await readFile(metaPath, 'utf8');
		return JSON.parse(raw) as PullMeta;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}
}

export async function getSpecialPullsStatus(
	projectDir: string,
): Promise<{
	hasDevHandoff: boolean;
	hasStyleGuide: boolean;
	hasTemplates: boolean;
}> {
	const pulls = await listPulls(projectDir);
	return {
		hasDevHandoff: pulls.some(p => p.special === 'devHandoff'),
		hasStyleGuide: pulls.some(p => p.special === 'styleGuide'),
		hasTemplates: pulls.some(p => p.special === 'templates'),
	};
}

export async function findSpecialPull(
	projectDir: string,
	kind: SpecialPullKind,
): Promise<PullMeta | null> {
	const pulls = await listPulls(projectDir);
	return pulls.find(p => p.special === kind) ?? null;
}

export async function writePullMeta(
	projectDir: string,
	slug: string,
	meta: PullMeta,
): Promise<void> {
	const path = join(projectDir, DESIGN_DIRNAME, slug, 'meta.json');
	await mkdir(dirname(path), {recursive: true});
	await writeFileAtomic(path, JSON.stringify(meta, null, 2) + '\n');
}
