import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	deepMergeInto,
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

test('applyThemeJsonPatch: no-op when patch has no fields', async t => {
	const path = await setupThemeJson(t, {settings: {color: {palette: []}}});
	const result = await applyThemeJsonPatch(path, {});
	t.is(result.wrote, false);
	t.deepEqual(result.touched, []);
});

test('applyThemeJsonPatch: deep-merges into styles.blocks', async t => {
	const path = await setupThemeJson(t, {
		styles: {blocks: {'core/paragraph': {color: {text: '#000'}}}},
	});
	const result = await applyThemeJsonPatch(path, {
		blocks: {
			'core/paragraph': {color: {background: '#fff'}},
			'core/button': {variations: {'neptune-fill-small': {css: '.x{}'}}},
		} as Record<string, unknown>,
	});
	t.is(result.wrote, true);
	t.deepEqual(result.touched, ['styles.blocks']);

	const written = await readThemeJson(path);
	t.deepEqual((written.styles as Record<string, unknown>).blocks, {
		'core/paragraph': {color: {text: '#000', background: '#fff'}},
		'core/button': {variations: {'neptune-fill-small': {css: '.x{}'}}},
	} as unknown);
});

test('applyThemeJsonPatch: deep-merges into settings.custom', async t => {
	const path = await setupThemeJson(t, {
		settings: {custom: {hero: {height: '500px'}}},
	});
	const result = await applyThemeJsonPatch(path, {
		custom: {
			hero: {ribbonOffset: '24px'},
			cards: {radius: '12px'},
		},
	});
	t.is(result.wrote, true);
	t.deepEqual(result.touched, ['settings.custom']);

	const written = await readThemeJson(path);
	t.deepEqual((written.settings as Record<string, unknown>).custom, {
		hero: {height: '500px', ribbonOffset: '24px'},
		cards: {radius: '12px'},
	});
});

test('applyThemeJsonPatch: preserves untouched top-level keys', async t => {
	const original = {
		version: 3,
		settings: {
			color: {palette: [{slug: 'primary', color: '#abcdef'}]},
			custom: {hero: {height: '500px'}},
		},
		styles: {
			color: {background: '#ffffff'},
			blocks: {},
		},
		customTemplates: [{name: 'tpl', title: 'Tpl'}],
		templateParts: [{name: 'header', area: 'header'}],
	};
	const path = await setupThemeJson(t, original);
	await applyThemeJsonPatch(path, {
		blocks: {'core/heading': {typography: {fontSize: '32px'}}},
	});
	const written = await readThemeJson(path);
	t.is(written.version, 3);
	t.deepEqual(written.customTemplates, original.customTemplates);
	t.deepEqual(written.templateParts, original.templateParts);
	t.deepEqual(
		(written.settings as Record<string, unknown>).color,
		original.settings.color,
	);
	t.deepEqual(
		(written.styles as Record<string, unknown>).color,
		original.styles.color,
	);
});

test('applyThemeJsonPatch: creates styles/blocks subtree if missing', async t => {
	const path = await setupThemeJson(t, {version: 3});
	await applyThemeJsonPatch(path, {
		blocks: {'core/paragraph': {color: {text: '#222'}}},
	});
	const written = await readThemeJson(path);
	t.deepEqual((written.styles as Record<string, unknown>).blocks, {
		'core/paragraph': {color: {text: '#222'}},
	});
});

test('applyThemeJsonPatch: applying both subtrees reports both touched', async t => {
	const path = await setupThemeJson(t, {});
	const result = await applyThemeJsonPatch(path, {
		blocks: {'core/paragraph': {color: {text: '#000'}}},
		custom: {token: {x: '1px'}},
	});
	t.deepEqual(result.touched, ['styles.blocks', 'settings.custom']);
});

test('applyThemeJsonPatch: arrays in patch replace, not merge', async t => {
	const path = await setupThemeJson(t, {
		styles: {blocks: {'core/list': {someArr: ['a', 'b', 'c']}}},
	});
	await applyThemeJsonPatch(path, {
		blocks: {'core/list': {someArr: ['x']}} as Record<string, unknown>,
	});
	const written = await readThemeJson(path);
	const blocks = (written.styles as Record<string, unknown>).blocks as Record<
		string,
		Record<string, unknown>
	>;
	t.deepEqual(blocks['core/list']!['someArr'], ['x']);
});

test('readThemeJson: throws on non-object root', async t => {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(path, '[1,2,3]', 'utf8');
	await t.throwsAsync(() => readThemeJson(path), {
		message: /did not parse to a JSON object/,
	});
});

test('deepMergeInto: replaces primitive with primitive', t => {
	const dest: Record<string, unknown> = {a: 1, b: 'x'};
	deepMergeInto(dest, {a: 2, c: true});
	t.deepEqual(dest, {a: 2, b: 'x', c: true});
});

test('deepMergeInto: recurses into nested objects', t => {
	const dest: Record<string, unknown> = {a: {x: 1, y: 2}};
	deepMergeInto(dest, {a: {y: 99, z: 3}});
	t.deepEqual(dest, {a: {x: 1, y: 99, z: 3}});
});

test('deepMergeInto: replaces object with primitive', t => {
	const dest: Record<string, unknown> = {a: {x: 1}};
	deepMergeInto(dest, {a: 'replaced'});
	t.deepEqual(dest, {a: 'replaced'});
});

test('applyBlockStyleVariations: empty array writes nothing', async t => {
	const dir = await makeTmpDir(t);
	const result = await applyBlockStyleVariations(dir, []);
	t.deepEqual(result.written, []);
	const entries = await readdir(dir).catch(() => []);
	t.deepEqual(entries, []);
});

test('applyBlockStyleVariations: writes one file per slug under styles/blocks', async t => {
	const themePath = await makeTmpDir(t);
	const result = await applyBlockStyleVariations(themePath, [
		{
			slug: 'neptune-fill-small',
			title: 'Fill Small',
			blockTypes: ['core/button'],
			styles: {spacing: {padding: '8px 16px'}},
		},
		{
			slug: 'neptune-section-callout',
			title: 'Section Callout',
			blockTypes: ['core/group', 'core/cover'],
			styles: {color: {background: '#000', text: '#fff'}},
		},
	]);
	t.is(result.written.length, 2);

	const blocksDir = join(themePath, 'styles', 'blocks');
	const files = await readdir(blocksDir);
	t.deepEqual(files.sort(), [
		'neptune-fill-small.json',
		'neptune-section-callout.json',
	]);

	const fillSmall = JSON.parse(
		await readFile(join(blocksDir, 'neptune-fill-small.json'), 'utf8'),
	);
	t.is(fillSmall['$schema'], 'https://schemas.wp.org/trunk/theme.json');
	t.is(fillSmall.version, 3);
	t.is(fillSmall.slug, 'neptune-fill-small');
	t.is(fillSmall.title, 'Fill Small');
	t.deepEqual(fillSmall.blockTypes, ['core/button']);
	t.deepEqual(fillSmall.styles, {spacing: {padding: '8px 16px'}});
});

test('applyBlockStyleVariations: re-running with same slug overwrites', async t => {
	const themePath = await makeTmpDir(t);
	await applyBlockStyleVariations(themePath, [
		{
			slug: 'neptune-x',
			title: 'Old',
			blockTypes: ['core/button'],
			styles: {color: {text: '#000'}},
		},
	]);
	await applyBlockStyleVariations(themePath, [
		{
			slug: 'neptune-x',
			title: 'New',
			blockTypes: ['core/button'],
			styles: {color: {text: '#fff'}},
		},
	]);
	const file = JSON.parse(
		await readFile(
			join(themePath, 'styles', 'blocks', 'neptune-x.json'),
			'utf8',
		),
	);
	t.is(file.title, 'New');
	t.is(file.styles.color.text, '#fff');
});

test('applyBlockStyleVariations: creates styles/blocks if missing', async t => {
	const themePath = await makeTmpDir(t);
	// no styles dir yet
	await applyBlockStyleVariations(themePath, [
		{
			slug: 'neptune-x',
			title: 'X',
			blockTypes: ['core/button'],
			styles: {},
		},
	]);
	const stat = await readdir(join(themePath, 'styles', 'blocks'));
	t.deepEqual(stat, ['neptune-x.json']);
});

test('readBlockStyleVariations: returns [] when styles/blocks is missing', async t => {
	const themePath = await makeTmpDir(t);
	const result = await readBlockStyleVariations(themePath);
	t.deepEqual(result, []);
});

test('readBlockStyleVariations: round-trips files written by applyBlockStyleVariations', async t => {
	const themePath = await makeTmpDir(t);
	await applyBlockStyleVariations(themePath, [
		{
			slug: 'neptune-fill-small',
			title: 'Fill Small',
			blockTypes: ['core/button'],
			styles: {spacing: {padding: '8px 16px'}},
		},
		{
			slug: 'neptune-section-callout',
			title: 'Section Callout',
			blockTypes: ['core/group', 'core/cover'],
			styles: {color: {background: '#000', text: '#fff'}},
		},
	]);
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
	// Missing styles
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

test('atomic write semantics: temp file does not appear in final dir', async t => {
	const path = await setupThemeJson(t, {styles: {blocks: {}}});
	await applyThemeJsonPatch(path, {
		blocks: {'core/paragraph': {color: {text: '#abc'}}},
	});
	// The dir should contain only theme.json, no .tmp files.
	const dir = path.slice(0, path.lastIndexOf('/'));
	const {readdir} = await import('node:fs/promises');
	const entries = await readdir(dir);
	t.deepEqual(entries.sort(), ['theme.json']);

	// The written file is valid JSON.
	const raw = await readFile(path, 'utf8');
	t.notThrows(() => JSON.parse(raw));
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
