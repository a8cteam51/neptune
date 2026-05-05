import test from 'ava';
import {upsertBlockStyle} from '../../source/lib/block-styles-config.js';

test('upsertBlockStyle: appends a new entry', t => {
	const out = upsertBlockStyle([], {
		block: 'core/button',
		name: 'fill-small',
		label: 'Fill Small',
	});
	t.deepEqual(out, [
		{block: 'core/button', name: 'fill-small', label: 'Fill Small'},
	]);
});

test('upsertBlockStyle: updates an existing (block, name) pair', t => {
	const start = [
		{block: 'core/button', name: 'fill-small', label: 'Old Label'},
		{block: 'core/heading', name: 'underlined', label: 'Underlined'},
	];
	const out = upsertBlockStyle(start, {
		block: 'core/button',
		name: 'fill-small',
		label: 'New Label',
	});
	t.is(out.length, 2);
	t.is(out[0]!.label, 'New Label');
	// Order preserved.
	t.is(out[1]!.block, 'core/heading');
});

test('upsertBlockStyle: does not mutate input', t => {
	const start = [{block: 'core/button', name: 'a', label: 'A'}];
	const snapshot = JSON.parse(JSON.stringify(start));
	upsertBlockStyle(start, {block: 'core/button', name: 'a', label: 'B'});
	t.deepEqual(start, snapshot);
});

test('upsertBlockStyle: appends when block matches but name differs', t => {
	const start = [{block: 'core/button', name: 'fill-small', label: 'A'}];
	const out = upsertBlockStyle(start, {
		block: 'core/button',
		name: 'outline-small',
		label: 'B',
	});
	t.is(out.length, 2);
	t.is(out[1]!.name, 'outline-small');
});
