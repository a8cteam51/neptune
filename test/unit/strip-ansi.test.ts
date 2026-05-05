import test from 'ava';
import {
	redactUrlCredentials,
	stripAnsi,
} from '../../source/lib/strip-ansi.js';

test('stripAnsi: removes CSI colour codes', t => {
	t.is(stripAnsi('\x1B[31mred\x1B[0m'), 'red');
	t.is(
		stripAnsi('plain \x1B[1;32mgreen bold\x1B[m end'),
		'plain green bold end',
	);
});

test('stripAnsi: removes OSC sequences (terminator-bell)', t => {
	t.is(stripAnsi('\x1B]0;title\x07after'), 'after');
});

test('stripAnsi: leaves plain text untouched', t => {
	t.is(stripAnsi('nothing to strip'), 'nothing to strip');
	t.is(stripAnsi(''), '');
});

test('stripAnsi: leaves stray ESC alone if no terminator follows', t => {
	t.is(stripAnsi('foo\x1Bbar'), 'foo\x1Bbar');
});

test('redactUrlCredentials: masks user:token in https URL', t => {
	t.is(
		redactUrlCredentials('https://x-access-token:GHTOKEN@github.com/org/repo.git'),
		'https://***:***@github.com/org/repo.git',
	);
});

test('redactUrlCredentials: handles multiple URLs in a string', t => {
	const input =
		'failed clone https://a:b@x.com/r and https://c:d@y.com/s plain';
	t.is(
		redactUrlCredentials(input),
		'failed clone https://***:***@x.com/r and https://***:***@y.com/s plain',
	);
});

test('redactUrlCredentials: leaves URLs without credentials alone', t => {
	t.is(
		redactUrlCredentials('clone of https://github.com/org/repo failed'),
		'clone of https://github.com/org/repo failed',
	);
});

test('redactUrlCredentials: ignores ssh-style URLs (no creds in URL form)', t => {
	t.is(
		redactUrlCredentials('git@github.com:org/repo.git'),
		'git@github.com:org/repo.git',
	);
});
