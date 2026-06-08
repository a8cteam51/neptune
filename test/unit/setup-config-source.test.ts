import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {
	loadOrInit,
	markClaudeDesignImported,
} from '../../source/commands/setup-project/config.js';
import {makeTmpDir} from '../helpers/tmp.js';

const now = () => '2026-06-08T00:00:00.000Z';

async function writeConfig(dir: string, extra: Record<string, unknown>) {
	await writeFile(
		join(dir, 'neptune-config.json'),
		JSON.stringify({
			createdAt: '2026-06-01T00:00:00.000Z',
			updatedAt: '2026-06-01T00:00:00.000Z',
			design: {pagesDir: 'design'},
			steps: {initialized: true},
			...extra,
		}),
	);
}

test('normalizeConfig defaults source to figma for legacy configs', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {});
	const loaded = await loadOrInit(dir, now);
	t.is(loaded.config.source, 'figma');
	t.is(loaded.config.claudeDesign, undefined);
});

test('normalizeConfig preserves a claude-design source + state', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {
		source: 'claude-design',
		claudeDesign: {importedAt: 'x', sourceDir: '/pkg'},
	});
	const loaded = await loadOrInit(dir, now);
	t.is(loaded.config.source, 'claude-design');
	t.deepEqual(loaded.config.claudeDesign, {importedAt: 'x', sourceDir: '/pkg'});
});

test('markClaudeDesignImported flips source and records the dir', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {themeSlug: 'mytheme'});
	const loaded = await loadOrInit(dir, now);
	t.is(loaded.config.source, 'figma');

	const updated = await markClaudeDesignImported(loaded, '/some/package', now);
	t.is(updated.config.source, 'claude-design');
	t.is(updated.config.claudeDesign?.sourceDir, '/some/package');
	t.is(updated.config.claudeDesign?.importedAt, now());

	// Persisted to disk.
	const onDisk = JSON.parse(
		await readFile(join(dir, 'neptune-config.json'), 'utf8'),
	);
	t.is(onDisk.source, 'claude-design');
	t.is(onDisk.claudeDesign.sourceDir, '/some/package');
});
