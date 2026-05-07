import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {loadOrInit} from '../../source/commands/setup-project/config.js';
import {makeTmpDir} from '../helpers/tmp.js';

const now = () => '2026-05-07T00:00:00.000Z';

test('loadOrInit writes provider: claude for new projects', async t => {
	const projectDirectory = await makeTmpDir(t);
	const loaded = await loadOrInit(projectDirectory, now);
	t.is(loaded.config.provider, 'claude');
	const raw = await readFile(
		join(projectDirectory, 'neptune-config.json'),
		'utf8',
	);
	t.is(JSON.parse(raw).provider, 'claude');
});

test('loadOrInit defaults old configs without provider to claude', async t => {
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
	t.is(loaded.config.provider, 'claude');
});

test('loadOrInit accepts provider: codex', async t => {
	const projectDirectory = await makeTmpDir(t);
	await writeFile(
		join(projectDirectory, 'neptune-config.json'),
		JSON.stringify({
			provider: 'codex',
			createdAt: '2026-05-06T00:00:00.000Z',
			updatedAt: '2026-05-06T00:00:00.000Z',
			design: {pagesDir: 'design'},
			steps: {initialized: true},
		}),
	);
	const loaded = await loadOrInit(projectDirectory, now);
	t.is(loaded.config.provider, 'codex');
});

test('loadOrInit rejects unknown providers', async t => {
	const projectDirectory = await makeTmpDir(t);
	await writeFile(
		join(projectDirectory, 'neptune-config.json'),
		JSON.stringify({
			provider: 'openai',
			createdAt: '2026-05-06T00:00:00.000Z',
			updatedAt: '2026-05-06T00:00:00.000Z',
			design: {pagesDir: 'design'},
			steps: {initialized: true},
		}),
	);
	await t.throwsAsync(loadOrInit(projectDirectory, now), {
		message: /provider/,
	});
});
