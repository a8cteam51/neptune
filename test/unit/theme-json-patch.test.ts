import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {
	formatBlockStyleVariationsContext,
	inspectLayoutWidths,
	readBlockStyleVariations,
	readThemeJson,
} from '../../source/lib/theme-json-patch.js';
import {makeTmpDir} from '../helpers/tmp.js';

async function setupThemeJson(
	t: import('ava').ExecutionContext,
	body: Record<string, unknown>,
): Promise<string> {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(path, JSON.stringify(body, null, '\t') + '\n', 'utf8');
	return path;
}

test('readThemeJson: throws on non-object root', async t => {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(path, '[1,2,3]', 'utf8');
	await t.throwsAsync(readThemeJson(path), {
		message: /did not parse to a JSON object/i,
	});
});

test('readBlockStyleVariations: returns [] when styles/blocks is missing', async t => {
	const themePath = await makeTmpDir(t);
	const result = await readBlockStyleVariations(themePath);
	t.deepEqual(result, []);
});

test('readBlockStyleVariations: reads files matching the variation shape', async t => {
	const themePath = await makeTmpDir(t);
	const blocksDir = join(themePath, 'styles', 'blocks');
	await mkdir(blocksDir, {recursive: true});
	await writeFile(
		join(blocksDir, 'neptune-fill-small.json'),
		JSON.stringify({
			$schema: 'https://schemas.wp.org/trunk/theme.json',
			version: 3,
			slug: 'neptune-fill-small',
			title: 'Fill Small',
			blockTypes: ['core/button'],
			styles: {spacing: {padding: '8px 16px'}},
		}),
		'utf8',
	);
	await writeFile(
		join(blocksDir, 'neptune-section-callout.json'),
		JSON.stringify({
			$schema: 'https://schemas.wp.org/trunk/theme.json',
			version: 3,
			slug: 'neptune-section-callout',
			title: 'Section Callout',
			blockTypes: ['core/group', 'core/cover'],
			styles: {color: {background: '#000', text: '#fff'}},
		}),
		'utf8',
	);
	const result = await readBlockStyleVariations(themePath);
	t.is(result.length, 2);
	const slugs = result.map(v => v.slug).sort();
	t.deepEqual(slugs, ['neptune-fill-small', 'neptune-section-callout']);
	const callout = result.find(v => v.slug === 'neptune-section-callout')!;
	t.is(callout.title, 'Section Callout');
	t.deepEqual(callout.blockTypes, ['core/group', 'core/cover']);
	t.deepEqual(callout.styles, {color: {background: '#000', text: '#fff'}});
});

test('readBlockStyleVariations: skips malformed JSON and reports via onWarn', async t => {
	const themePath = await makeTmpDir(t);
	const blocksDir = join(themePath, 'styles', 'blocks');
	await mkdir(blocksDir, {recursive: true});
	await writeFile(join(blocksDir, 'broken.json'), 'not json', 'utf8');
	await writeFile(
		join(blocksDir, 'neptune-good.json'),
		JSON.stringify({
			slug: 'neptune-good',
			title: 'Good',
			blockTypes: ['core/button'],
			styles: {color: {background: '#fff'}},
		}),
		'utf8',
	);
	const warnings: string[] = [];
	const result = await readBlockStyleVariations(themePath, msg =>
		warnings.push(msg),
	);
	t.is(result.length, 1);
	t.is(result[0]!.slug, 'neptune-good');
	t.true(warnings.some(w => w.includes('broken.json')));
});

test('readBlockStyleVariations: skips files missing required fields', async t => {
	const themePath = await makeTmpDir(t);
	const blocksDir = join(themePath, 'styles', 'blocks');
	await mkdir(blocksDir, {recursive: true});
	await writeFile(
		join(blocksDir, 'partial.json'),
		JSON.stringify({
			slug: 'neptune-x',
			title: 'X',
			blockTypes: ['core/button'],
		}),
		'utf8',
	);
	const warnings: string[] = [];
	const result = await readBlockStyleVariations(themePath, msg =>
		warnings.push(msg),
	);
	t.deepEqual(result, []);
	t.is(warnings.length, 1);
});

test('formatBlockStyleVariationsContext: returns null on empty input', t => {
	t.is(formatBlockStyleVariationsContext([]), null);
});

test('formatBlockStyleVariationsContext: emits parseable JSON', t => {
	const out = formatBlockStyleVariationsContext([
		{
			slug: 'neptune-x',
			title: 'X',
			blockTypes: ['core/button'],
			styles: {color: {text: '#000'}},
		},
	]);
	t.truthy(out);
	const parsed = JSON.parse(out!);
	t.true(Array.isArray(parsed));
	t.is(parsed[0].slug, 'neptune-x');
	t.deepEqual(parsed[0].styles, {color: {text: '#000'}});
});

test('inspectLayoutWidths: flags both unset when settings.layout is missing', async t => {
	const path = await setupThemeJson(t, {settings: {}});
	const r = await inspectLayoutWidths(path);
	t.deepEqual(r, {contentSizeMissing: true, wideSizeMissing: true});
});

test('inspectLayoutWidths: empty strings count as unset', async t => {
	const path = await setupThemeJson(t, {
		settings: {layout: {contentSize: '', wideSize: '   '}},
	});
	const r = await inspectLayoutWidths(path);
	t.deepEqual(r, {contentSizeMissing: true, wideSizeMissing: true});
});

test('inspectLayoutWidths: detects mixed presence', async t => {
	const path = await setupThemeJson(t, {
		settings: {layout: {contentSize: '780px', wideSize: ''}},
	});
	const r = await inspectLayoutWidths(path);
	t.deepEqual(r, {contentSizeMissing: false, wideSizeMissing: true});
});

test('inspectLayoutWidths: both filled passes', async t => {
	const path = await setupThemeJson(t, {
		settings: {layout: {contentSize: '780px', wideSize: '1200px'}},
	});
	const r = await inspectLayoutWidths(path);
	t.deepEqual(r, {contentSizeMissing: false, wideSizeMissing: false});
});

test('inspectLayoutWidths: missing file flags both unset (best-effort)', async t => {
	const dir = await makeTmpDir(t);
	const r = await inspectLayoutWidths(join(dir, 'theme.json'));
	t.deepEqual(r, {contentSizeMissing: true, wideSizeMissing: true});
});
