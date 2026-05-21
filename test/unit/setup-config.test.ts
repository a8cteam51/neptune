import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {loadOrInit} from '../../source/commands/setup-project/config.js';
import {makeTmpDir} from '../helpers/tmp.js';

const now = () => '2026-05-07T00:00:00.000Z';

test('loadOrInit writes a fresh config for new projects', async t => {
	const projectDirectory = await makeTmpDir(t);
	const loaded = await loadOrInit(projectDirectory, now);
	t.is(loaded.mode, 'created');
	t.is(loaded.config.design.pagesDir, 'design');
	t.true(loaded.config.steps.initialized);
	const raw = await readFile(
		join(projectDirectory, 'neptune-config.json'),
		'utf8',
	);
	const parsed = JSON.parse(raw);
	t.is(parsed.design.pagesDir, 'design');
});

test('loadOrInit continues an existing config without rewriting timestamps', async t => {
	const projectDirectory = await makeTmpDir(t);
	await writeFile(
		join(projectDirectory, 'neptune-config.json'),
		JSON.stringify({
			createdAt: '2026-05-06T00:00:00.000Z',
			updatedAt: '2026-05-06T00:00:00.000Z',
			design: {pagesDir: 'design'},
			steps: {initialized: true},
		}),
	);
	const loaded = await loadOrInit(projectDirectory, now);
	t.is(loaded.mode, 'continued');
	t.is(loaded.config.createdAt, '2026-05-06T00:00:00.000Z');
});
