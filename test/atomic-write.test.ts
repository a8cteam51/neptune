import test from 'ava';
import {readFile, mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFileAtomic} from '../source/lib/atomic-write.js';

test('writeFileAtomic writes the target file', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'neptune-atomic-'));
	t.teardown(() => rm(dir, {recursive: true, force: true}));
	const target = join(dir, 'out.json');
	await writeFileAtomic(target, '{"hello":1}');
	t.is(await readFile(target, 'utf8'), '{"hello":1}');
});

test('writeFileAtomic leaves no .tmp on success', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'neptune-atomic-'));
	t.teardown(() => rm(dir, {recursive: true, force: true}));
	const target = join(dir, 'out.json');
	await writeFileAtomic(target, 'data');
	const entries = await readdir(dir);
	t.deepEqual(entries, ['out.json']);
});
