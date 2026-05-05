// Thin wrapper around node:child_process.spawn so callers (studio,
// content-clone, etc.) can be tested with an injected fake. Default
// behaviour is identical to the standard library; pass a Spawn fake in
// tests to capture argv, drive stdio, or simulate exit codes.
import {
	spawn as nodeSpawn,
	type ChildProcess,
	type SpawnOptions,
} from 'node:child_process';

export type Spawn = (
	command: string,
	args: readonly string[],
	options?: SpawnOptions,
) => ChildProcess;

export const defaultSpawn: Spawn = (cmd, args, opts) =>
	opts === undefined
		? nodeSpawn(cmd, [...args])
		: nodeSpawn(cmd, [...args], opts);
