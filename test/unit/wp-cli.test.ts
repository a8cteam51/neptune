import test from 'ava';
import {shellSingleQuote} from '../../source/lib/wp-cli.js';

test('shellSingleQuote: wraps a value with no special chars', t => {
	t.is(shellSingleQuote('hello'), "'hello'");
});

test('shellSingleQuote: escapes embedded single quotes', t => {
	t.is(shellSingleQuote("Don't"), "'Don'\\''t'");
});

test('shellSingleQuote: handles JSON payloads with double quotes', t => {
	t.is(
		shellSingleQuote('{"a":1,"b":"c"}'),
		'\'{"a":1,"b":"c"}\'',
	);
});

test('shellSingleQuote: handles multiple embedded single quotes', t => {
	t.is(shellSingleQuote("a'b'c"), "'a'\\''b'\\''c'");
});

test('shellSingleQuote: empty string', t => {
	t.is(shellSingleQuote(''), "''");
});
