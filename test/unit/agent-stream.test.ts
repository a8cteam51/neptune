import test from 'ava';
import {extractSkillName, stripFences} from '../../source/lib/agent-stream.js';
import {normalizeAgentProvider} from '../../source/lib/agent-provider.js';

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

test('normalizeAgentProvider defaults missing config to claude', t => {
	t.is(normalizeAgentProvider(undefined), 'claude');
});

test('normalizeAgentProvider accepts claude and codex only', t => {
	t.is(normalizeAgentProvider('claude'), 'claude');
	t.is(normalizeAgentProvider('codex'), 'codex');
	t.throws(() => normalizeAgentProvider('openai'), {
		message: /claude.*codex/,
	});
});

test('extractSkillName finds the requested Neptune skill in text input', t => {
	t.is(
		extractSkillName('Use the tsx-to-blocks skill. Return JSON.'),
		'tsx-to-blocks',
	);
});

test('extractSkillName finds the requested Neptune skill in block input', t => {
	t.is(
		extractSkillName([
			{type: 'text', text: 'Compare screenshots.'},
			{type: 'text', text: 'Use the visual-diff skill.'},
		]),
		'visual-diff',
	);
});
