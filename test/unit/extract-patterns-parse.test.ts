import test from 'ava';
import {parseTopLevelFunctions} from '../../source/commands/extract-patterns-parse.js';

test('captures a single non-default function', t => {
	const src = `function Card(props) {
  return <div>{props.title}</div>;
}
export default function Page() {
  return <Card title="x" />;
}`;
	const result = parseTopLevelFunctions(src);
	t.is(result.defaultName, 'Page');
	t.deepEqual(
		result.functions.map(f => f.name),
		['Card', 'Page'],
	);
	const card = result.functions.find(f => f.name === 'Card')!;
	t.is(
		src
			.slice(card.start, card.end + 1)
			.trim()
			.endsWith('}'),
		true,
	);
});

test('handles trailing `export default Foo;` form', t => {
	const src = `function Foo() { return null; }
export default Foo;`;
	const result = parseTopLevelFunctions(src);
	t.is(result.defaultName, 'Foo');
	t.is(result.functions.length, 1);
});

test('skips braces inside string literals', t => {
	const src = `function A() {
  const s = "{ not a brace }";
  const t = '{}';
  return s + t;
}`;
	const result = parseTopLevelFunctions(src);
	t.is(result.functions.length, 1);
	t.is(result.functions[0]!.name, 'A');
	const body = src.slice(
		result.functions[0]!.start,
		result.functions[0]!.end + 1,
	);
	t.true(body.trim().endsWith('}'));
});

test('skips braces inside template literals', t => {
	const src = 'function A() { const s = `${1 + 2}`; return s; }';
	const result = parseTopLevelFunctions(src);
	t.is(result.functions.length, 1);
});

test('skips braces inside line comments', t => {
	const src = `function A() {
  // closing brace } shouldn't end the function
  return 1;
}`;
	const result = parseTopLevelFunctions(src);
	t.is(result.functions.length, 1);
});

test('skips braces inside block comments', t => {
	const src = `function A() {
  /* unbalanced { } pretend */
  return 1;
}`;
	const result = parseTopLevelFunctions(src);
	t.is(result.functions.length, 1);
});

test('captures multiple top-level functions in order', t => {
	const src = `function A() { return 1; }
function B() { return 2; }
function C() { return 3; }
export default function Page() { return null; }`;
	const result = parseTopLevelFunctions(src);
	t.deepEqual(
		result.functions.map(f => f.name),
		['A', 'B', 'C', 'Page'],
	);
	t.is(result.defaultName, 'Page');
});

test('handles no default export', t => {
	const src = `function A() { return 1; }`;
	const result = parseTopLevelFunctions(src);
	t.is(result.defaultName, null);
	t.is(result.functions.length, 1);
});

test('preserves correct end index across nested braces', t => {
	const src = `function A() {
  const x = { a: 1, b: { c: 2 } };
  return x;
}`;
	const result = parseTopLevelFunctions(src);
	const fn = result.functions[0]!;
	t.is(src[fn.end], '}');
	t.is(
		src
			.slice(fn.start, fn.end + 1)
			.trim()
			.endsWith('};\n}'),
		false,
	);
});
