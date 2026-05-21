import test from 'ava';
import {stripFences} from '../../source/lib/agent-stream.js';

test('stripFences leaves text without fences alone', t => {
	t.is(stripFences('hello world'), 'hello world');
});

test('stripFences strips a balanced ```lang fence', t => {
	t.is(stripFences('```json\n{"a":1}\n```'), '{"a":1}');
});

test('stripFences leaves single-line input alone', t => {
	t.is(stripFences('```{}```'), '```{}```');
});

test('stripFences leaves an unterminated fence alone', t => {
	t.is(
		stripFences('```json\n{"a":1}\nrest of message'),
		'```json\n{"a":1}\nrest of message',
	);
});
