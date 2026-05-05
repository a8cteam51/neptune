import test from 'ava';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {Readable, Writable} from 'node:stream';
import {parseStudioJson} from '../../source/integrations/studio/site.js';
import {
	getSiteUrl,
	getStudioSiteStatus,
	listStudioSites,
} from '../../source/integrations/studio/site.js';
import type {Spawn} from '../../source/lib/spawn.js';

function makeFakeSpawn(stdout: string, exitCode = 0): Spawn {
	return ((_cmd: string, _args: readonly string[]) => {
		const child = new EventEmitter() as unknown as ChildProcess & {
			stdout: Readable;
			stderr: Readable;
			stdin: Writable;
		};
		const stdoutStream = new Readable({read() {}});
		const stderrStream = new Readable({read() {}});
		child.stdout = stdoutStream;
		child.stderr = stderrStream;
		child.stdin = new Writable({write: (_c, _e, cb) => cb()});
		(child as ChildProcess).kill = () => true;
		// Push data first, end the streams, then emit close on the next
		// tick so consumers' 'data' handlers run before our resolution.
		setImmediate(() => {
			stdoutStream.push(stdout);
			stdoutStream.push(null);
			stderrStream.push(null);
			setImmediate(() => {
				(child as EventEmitter).emit('close', exitCode, null);
				(child as EventEmitter).emit('exit', exitCode, null);
			});
		});
		return child as ChildProcess;
	}) as Spawn;
}

const SAMPLE_LIST_OUTPUT = `\x1B[K\x1B[?25l⠋ Loading sites…
\x1B[1A\x1B[K\x1B[?25l✔ Found 2 sites
\x1B[?25h[{"id":"a","name":"Foo","path":"/Users/me/projects/foo/wordpress","port":8881,"url":"http://localhost:8881","running":false},{"id":"b","name":"Bar","path":"/Users/me/projects/bar/wordpress","port":8882,"url":"http://localhost:8882","running":true}]`;

test('parseStudioJson: strips ANSI cruft and parses trailing array', t => {
	const parsed = parseStudioJson(SAMPLE_LIST_OUTPUT);
	t.true(Array.isArray(parsed));
	t.is((parsed as unknown[]).length, 2);
});

test('parseStudioJson: throws when no JSON is present', t => {
	t.throws(() => parseStudioJson('just spinner output'), {
		message: /Could not locate JSON/i,
	});
});

test('listStudioSites: returns parsed entries via mocked spawn', async t => {
	const sites = await listStudioSites({
		spawn: makeFakeSpawn(SAMPLE_LIST_OUTPUT),
	});
	t.is(sites.length, 2);
	t.is(sites[0]!.name, 'Foo');
	t.false(sites[0]!.running);
	t.true(sites[1]!.running);
});

test('getSiteUrl: returns the URL of the matched site', async t => {
	const url = await getSiteUrl('/Users/me/projects/bar', {
		spawn: makeFakeSpawn(SAMPLE_LIST_OUTPUT),
	});
	t.is(url, 'http://localhost:8882');
});

test('getSiteUrl: returns null when no site matches', async t => {
	const url = await getSiteUrl('/Users/me/projects/nope', {
		spawn: makeFakeSpawn(SAMPLE_LIST_OUTPUT),
	});
	t.is(url, null);
});

test('getStudioSiteStatus: running site returns state running + URL', async t => {
	const status = await getStudioSiteStatus('/Users/me/projects/bar', {
		spawn: makeFakeSpawn(SAMPLE_LIST_OUTPUT),
	});
	t.is(status.state, 'running');
	if (status.state === 'running') {
		t.is(status.url, 'http://localhost:8882');
	}
});

test('getStudioSiteStatus: stopped site returns state stopped + URL', async t => {
	const status = await getStudioSiteStatus('/Users/me/projects/foo', {
		spawn: makeFakeSpawn(SAMPLE_LIST_OUTPUT),
	});
	t.is(status.state, 'stopped');
	if (status.state === 'stopped') {
		t.is(status.url, 'http://localhost:8881');
	}
});

test('getStudioSiteStatus: project with no Studio entry returns unknown', async t => {
	const status = await getStudioSiteStatus('/Users/me/projects/missing', {
		spawn: makeFakeSpawn(SAMPLE_LIST_OUTPUT),
	});
	t.is(status.state, 'unknown');
	if (status.state === 'unknown') {
		t.regex(status.reason, /no site registered/i);
	}
});

test('getStudioSiteStatus: spawn error surfaces as unknown with reason', async t => {
	const failingSpawn = makeFakeSpawn('not json output', 1);
	const status = await getStudioSiteStatus('/anything', {
		spawn: failingSpawn,
	});
	t.is(status.state, 'unknown');
});
