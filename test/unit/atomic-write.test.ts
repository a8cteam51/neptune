import test from 'ava';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {writeFileAtomic} from '../../source/lib/atomic-write.js';
import {makeTmpDir} from '../helpers/tmp.js';

test('writes the target file', async t => {
	const dir = await makeTmpDir(t);
	const target = join(dir, 'out.json');
	await writeFileAtomic(target, '{"hello":1}');
	t.is(await readFile(target, 'utf8'), '{"hello":1}');
});

test('leaves no .tmp on success', async t => {
	const dir = await makeTmpDir(t);
	const target = join(dir, 'out.json');
	await writeFileAtomic(target, 'data');
	t.deepEqual(await readdir(dir), ['out.json']);
});

test('overwrites an existing file with the new content', async t => {
	const dir = await makeTmpDir(t);
	const target = join(dir, 'out.txt');
	await writeFile(target, 'old');
	await writeFileAtomic(target, 'new');
	t.is(await readFile(target, 'utf8'), 'new');
});

test('throws on a missing parent directory and leaves nothing behind', async t => {
	const dir = await makeTmpDir(t);
	const target = join(dir, 'missing-subdir', 'out.txt');
	await t.throwsAsync(() => writeFileAtomic(target, 'data'));
	t.deepEqual(await readdir(dir), []);
});

test('concurrent writes both succeed; last writer wins', async t => {
	const dir = await makeTmpDir(t);
	const target = join(dir, 'out.txt');
	await Promise.all([
		writeFileAtomic(target, 'a'),
		writeFileAtomic(target, 'b'),
	]);
	const value = await readFile(target, 'utf8');
	t.true(value === 'a' || value === 'b');
	const entries = await readdir(dir);
	t.deepEqual(
		entries.filter(e => !e.startsWith('.')),
		['out.txt'],
	);
});

test('writes a Uint8Array buffer', async t => {
	const dir = await makeTmpDir(t);
	const target = join(dir, 'out.bin');
	await writeFileAtomic(target, new Uint8Array([1, 2, 3, 4]));
	const buf = await readFile(target);
	t.deepEqual([...buf], [1, 2, 3, 4]);
});
