import test from 'ava';
import {parseAgentJson} from '../../source/lib/build-envelope.js';

test('parseAgentJson: round-trips valid JSON', t => {
	const v = parseAgentJson('{"a":1}', 'x');
	t.deepEqual(v, {a: 1});
});

test('parseAgentJson: throws with label + preview on invalid JSON', t => {
	t.throws(() => parseAgentJson('not json at all', 'visual-diff'), {
		message: /visual-diff response was not valid JSON/,
	});
});

test('parseAgentJson: tolerates leading prose preamble', t => {
	const v = parseAgentJson(
		'Looking at the report, I will now emit:\n{"a":1,"b":2}',
		'visual-diff',
	);
	t.deepEqual(v, {a: 1, b: 2});
});

test('parseAgentJson: tolerates trailing prose summary', t => {
	const v = parseAgentJson(
		'{"a":1,"b":2}\n\nNote: I flagged three diffs because…',
		'visual-diff',
	);
	t.deepEqual(v, {a: 1, b: 2});
});

test('parseAgentJson: tolerates both leading and trailing prose', t => {
	const v = parseAgentJson(
		'Here is the report:\n\n{"a":1}\n\nLet me know if you want changes.',
		'visual-diff',
	);
	t.deepEqual(v, {a: 1});
});

test('parseAgentJson: prefers the largest balanced object when prose contains JSON snippets', t => {
	// Models sometimes echo a small JSON example in their prose before
	// emitting the full envelope. The real envelope is always larger.
	const input =
		'I will use {"slug":"foo"} as a reference, then output:\n' +
		'{"summary":"two diffs found","matches_design":false,"diffs":[]}';
	const v = parseAgentJson(input, 'visual-diff') as Record<string, unknown>;
	t.is(typeof v['summary'], 'string');
	t.is(v['matches_design'], false);
});

test('parseAgentJson: ignores braces inside JSON string values when balancing', t => {
	const v = parseAgentJson(
		'preamble {"summary":"a { left brace } in text","extra":"and a } and a { too"}',
		'visual-diff',
	) as Record<string, unknown>;
	t.is(v['summary'], 'a { left brace } in text');
	t.is(v['extra'], 'and a } and a { too');
});

test('parseAgentJson: handles escaped quotes inside strings', t => {
	const v = parseAgentJson(
		'prose {"q":"he said \\"hi\\" and left"} trailing',
		'visual-diff',
	);
	t.deepEqual(v, {q: 'he said "hi" and left'});
});

test('parseAgentJson: throws original error when no balanced object parses', t => {
	t.throws(
		() => parseAgentJson('only prose, no json {{ broken', 'visual-diff'),
		{message: /visual-diff response was not valid JSON/},
	);
});
