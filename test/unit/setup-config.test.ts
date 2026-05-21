import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {loadOrInit} from '../../source/commands/setup-project/config.js';
import {makeTmpDir} from '../helpers/tmp.js';

const now = () => '2026-05-07T00:00:00.000Z';
const BASE = {
	createdAt: '2026-05-06T00:00:00.000Z',
	updatedAt: '2026-05-06T00:00:00.000Z',
	design: {pagesDir: 'design'},
	steps: {initialized: true},
};

async function writeConfig(
	projectDir: string,
	body: Record<string, unknown>,
): Promise<void> {
	await writeFile(
		join(projectDir, 'neptune-config.json'),
		JSON.stringify(body),
	);
}

test('loadOrInit silently ignores a legacy provider field in old configs', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {...BASE, provider: 'codex'});
	const loaded = await loadOrInit(dir, now);
	// Field is dropped from the type; presence in the JSON is harmless.
	t.is((loaded.config as Record<string, unknown>)['provider'], undefined);
});

test('loadOrInit returns undefined haydi when absent', async t => {
	const dir = await makeTmpDir(t);
	const loaded = await loadOrInit(dir, now);
	t.is(loaded.config.haydi, undefined);
});

test('loadOrInit reads + url-trims a valid haydi config', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {
		...BASE,
		haydi: {url: 'http://localhost:8893/', token: 'abc123'},
	});
	const loaded = await loadOrInit(dir, now);
	t.deepEqual(loaded.config.haydi, {
		url: 'http://localhost:8893',
		token: 'abc123',
	});
});

test('loadOrInit rejects haydi without url', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {...BASE, haydi: {token: 'abc123'}});
	await t.throwsAsync(loadOrInit(dir, now), {message: /haydi\.url/i});
});

test('loadOrInit accepts haydi with url but no token (auto-write state)', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {...BASE, haydi: {url: 'http://localhost:8893'}});
	const loaded = await loadOrInit(dir, now);
	t.deepEqual(loaded.config.haydi, {url: 'http://localhost:8893'});
});

test('loadOrInit treats whitespace-only haydi.token as missing token', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {
		...BASE,
		haydi: {url: 'http://localhost:8893', token: '   '},
	});
	const loaded = await loadOrInit(dir, now);
	t.is(loaded.config.haydi?.token, undefined);
});

test('loadOrInit rejects haydi.url without http(s) scheme', async t => {
	const dir = await makeTmpDir(t);
	await writeConfig(dir, {
		...BASE,
		haydi: {url: 'localhost:8893', token: 'abc'},
	});
	await t.throwsAsync(loadOrInit(dir, now), {message: /http:\/\//i});
});
