import test from 'ava';
import {
	extractDevAnnotations,
	formatDevAnnotationsSection,
} from '../../source/lib/dev-annotations.js';

test('extractDevAnnotations: single note, no separator', t => {
	const code = `<div data-development-annotations="Just one note">x</div>`;
	t.deepEqual(extractDevAnnotations(code), [{notes: ['Just one note']}]);
});

test('extractDevAnnotations: splits on " | " and trims', t => {
	const code = `<div data-node-id="5:6" data-development-annotations="First note | Second note  |  Third"></div>`;
	t.deepEqual(extractDevAnnotations(code), [
		{nodeId: '5:6', notes: ['First note', 'Second note', 'Third']},
	]);
});

test('extractDevAnnotations: empty values produce no entry', t => {
	const code = `<div data-development-annotations=""></div>`;
	t.deepEqual(extractDevAnnotations(code), []);
});

test('extractDevAnnotations: only-separator value produces no entry', t => {
	const code = `<div data-development-annotations=" | | "></div>`;
	t.deepEqual(extractDevAnnotations(code), []);
});

test('extractDevAnnotations: associates node id from same opening tag', t => {
	const code = [
		`<div`,
		`  className="x"`,
		`  data-node-id="9:9"`,
		`  data-development-annotations="Note A | Note B"`,
		`>`,
		`</div>`,
	].join('\n');
	t.deepEqual(extractDevAnnotations(code), [
		{nodeId: '9:9', notes: ['Note A', 'Note B']},
	]);
});

test('extractDevAnnotations: handles entity-encoded characters', t => {
	const code = `<div data-development-annotations="Don&apos;t panic | &amp; carry on"></div>`;
	t.deepEqual(extractDevAnnotations(code), [
		{notes: ["Don't panic", '& carry on']},
	]);
});

test('extractDevAnnotations: multiple annotated nodes preserve order', t => {
	const code = [
		`<div data-node-id="1:1" data-development-annotations="alpha"></div>`,
		`<span data-node-id="2:2" data-development-annotations="beta | gamma"></span>`,
	].join('\n');
	t.deepEqual(extractDevAnnotations(code), [
		{nodeId: '1:1', notes: ['alpha']},
		{nodeId: '2:2', notes: ['beta', 'gamma']},
	]);
});

test('formatDevAnnotationsSection: empty list returns empty string', t => {
	t.is(formatDevAnnotationsSection([]), '');
});

test('formatDevAnnotationsSection: renders node ids and notes', t => {
	const out = formatDevAnnotationsSection([
		{nodeId: '5:6', notes: ['First', 'Second']},
		{notes: ['Orphan']},
	]);
	t.true(out.includes('On node 5:6:'));
	t.true(out.includes('  - First'));
	t.true(out.includes('  - Second'));
	t.true(out.includes('On an unidentified node:'));
	t.true(out.includes('  - Orphan'));
});
