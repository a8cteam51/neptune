import test from 'ava';
import {deepEqual} from '../../source/lib/build-variables.js';

test('primitives', t => {
	t.true(deepEqual(1, 1));
	t.true(deepEqual('a', 'a'));
	t.true(deepEqual(null, null));
	t.true(deepEqual(undefined, undefined));
	t.false(deepEqual(1, '1'));
	t.false(deepEqual(null, undefined));
	t.false(deepEqual(0, false));
});

test('arrays compare element-wise; order matters', t => {
	t.true(deepEqual([1, 2, 3], [1, 2, 3]));
	t.false(deepEqual([1, 2, 3], [3, 2, 1]));
	t.false(deepEqual([1, 2], [1, 2, 3]));
});

test('objects: key order does NOT matter (regression for JSON.stringify bug)', t => {
	t.true(deepEqual({a: 1, b: 2}, {b: 2, a: 1}));
	t.true(
		deepEqual(
			{nested: {x: 1, y: 2}, top: 'q'},
			{top: 'q', nested: {y: 2, x: 1}},
		),
	);
});

test('objects: differ on missing or extra keys', t => {
	t.false(deepEqual({a: 1}, {a: 1, b: 2}));
	t.false(deepEqual({a: 1, b: 2}, {a: 1}));
	t.false(deepEqual({a: 1}, {a: 2}));
});

test('arrays vs objects are not equal', t => {
	t.false(deepEqual([1, 2], {0: 1, 1: 2}));
});

test('null/undefined vs object', t => {
	t.false(deepEqual(null, {}));
	t.false(deepEqual({}, null));
	t.false(deepEqual({}, undefined));
});

test('handles a real Figma-style token', t => {
	const tokenA = {
		'color/primary': '#001f3f',
		'spacing/sm': '8px',
		'typography/heading': {family: 'Inter', size: '24px'},
	};
	const tokenB = {
		'spacing/sm': '8px',
		'typography/heading': {size: '24px', family: 'Inter'},
		'color/primary': '#001f3f',
	};
	t.true(deepEqual(tokenA, tokenB));
});
