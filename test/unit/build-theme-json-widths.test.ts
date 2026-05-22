import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {
	readExistingLayoutWidths,
	validateLayoutLength,
} from '../../source/commands/build-theme-json.js';
import {makeTmpDir} from '../helpers/tmp.js';

test('validateLayoutLength: empty input is allowed (means "leave unset")', t => {
	const r = validateLayoutLength('');
	t.deepEqual(r, {ok: true, value: ''});
	const r2 = validateLayoutLength('   ');
	t.deepEqual(r2, {ok: true, value: ''});
});

test('validateLayoutLength: common CSS lengths pass', t => {
	for (const v of ['780px', '60rem', '100%', '1200px', '50vw', '2.5em']) {
		t.deepEqual(validateLayoutLength(v), {ok: true, value: v});
	}
});

test('validateLayoutLength: calc / clamp / var pass', t => {
	t.deepEqual(validateLayoutLength('calc(100% - 32px)'), {
		ok: true,
		value: 'calc(100% - 32px)',
	});
	t.deepEqual(validateLayoutLength('clamp(320px, 80vw, 1200px)'), {
		ok: true,
		value: 'clamp(320px, 80vw, 1200px)',
	});
	t.deepEqual(validateLayoutLength('var(--content-width)'), {
		ok: true,
		value: 'var(--content-width)',
	});
});

test('validateLayoutLength: bare numbers and missing units fail', t => {
	t.is(validateLayoutLength('780').ok, false);
	t.is(validateLayoutLength('wide').ok, false);
	t.is(validateLayoutLength('1200 px').ok, false);
});

test('readExistingLayoutWidths: returns empty defaults when file does not exist', async t => {
	const dir = await makeTmpDir(t);
	const r = await readExistingLayoutWidths(join(dir, 'missing.json'));
	t.deepEqual(r, {contentSize: '', wideSize: ''});
});

test('readExistingLayoutWidths: extracts populated values', async t => {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(
		path,
		JSON.stringify({
			settings: {layout: {contentSize: '780px', wideSize: '1200px'}},
		}),
		'utf8',
	);
	const r = await readExistingLayoutWidths(path);
	t.deepEqual(r, {contentSize: '780px', wideSize: '1200px'});
});

test('readExistingLayoutWidths: blanks / whitespace count as unset', async t => {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(
		path,
		JSON.stringify({
			settings: {layout: {contentSize: '', wideSize: '   '}},
		}),
		'utf8',
	);
	const r = await readExistingLayoutWidths(path);
	t.deepEqual(r, {contentSize: '', wideSize: ''});
});

test('readExistingLayoutWidths: mixed presence is reported correctly', async t => {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(
		path,
		JSON.stringify({
			settings: {layout: {contentSize: '64rem'}},
		}),
		'utf8',
	);
	const r = await readExistingLayoutWidths(path);
	t.deepEqual(r, {contentSize: '64rem', wideSize: ''});
});

test('readExistingLayoutWidths: malformed JSON returns empty defaults', async t => {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(path, 'not json', 'utf8');
	const r = await readExistingLayoutWidths(path);
	t.deepEqual(r, {contentSize: '', wideSize: ''});
});

test('readExistingLayoutWidths: non-object root returns empty defaults', async t => {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(path, JSON.stringify([1, 2, 3]), 'utf8');
	const r = await readExistingLayoutWidths(path);
	t.deepEqual(r, {contentSize: '', wideSize: ''});
});

// Sanity-check that the file we just wrote can be read back to confirm
// the fixture mechanics for the readExistingLayoutWidths tests above.
test('readExistingLayoutWidths fixture: writeFile + readFile round-trips', async t => {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	const body = JSON.stringify({foo: 'bar'});
	await writeFile(path, body, 'utf8');
	t.is(await readFile(path, 'utf8'), body);
});
