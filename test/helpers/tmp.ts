// Per-test temp directory with auto-cleanup. Pass `t.teardown(...)` from
// AVA so the directory is rm -rf'd whether the test passes or throws.
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ExecutionContext} from 'ava';

export async function makeTmpDir(
	t: ExecutionContext,
	prefix = 'neptune-',
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	t.teardown(() => rm(dir, {recursive: true, force: true}));
	return dir;
}
