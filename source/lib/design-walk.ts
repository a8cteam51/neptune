// Source of truth for "what has been pulled". Each pull lives in
// design/<slug>/ and carries a meta.json describing it. We deliberately do
// NOT store this in neptune-config.json — config flags can drift from disk
// state (e.g. user deletes design/style-guide/ but config says it's pulled).
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
	hasStyleGuide: boolean;
	hasTemplates: boolean;
}> {
	const pulls = await listPulls(projectDir);
	return {
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

// Stable sort that puts header.html first, footer.html second, and
// everything else after in original order. Header and footer are
// referenced as template parts by every other template, so building /
// refining them first means downstream templates render correctly when
// it's their turn.
export function sortByTemplatePriority<T extends {templateFile?: string}>(
	pulls: ReadonlyArray<T>,
): T[] {
	const priority = (file?: string): number => {
		const lower = file?.toLowerCase();
		if (lower === 'header.html') return 0;
		if (lower === 'footer.html') return 1;
		return 2;
	};
	return [...pulls].sort(
		(a, b) => priority(a.templateFile) - priority(b.templateFile),
	);
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
