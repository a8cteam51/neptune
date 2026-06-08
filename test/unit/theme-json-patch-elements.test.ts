import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {
	applyThemeJsonPatch,
	readThemeJson,
} from '../../source/lib/theme-json-patch.js';
import {makeTmpDir} from '../helpers/tmp.js';

async function setup(
	t: import('ava').ExecutionContext,
	body: Record<string, unknown>,
): Promise<string> {
	const dir = await makeTmpDir(t);
	const path = join(dir, 'theme.json');
	await writeFile(path, JSON.stringify(body, null, '\t') + '\n', 'utf8');
	return path;
}

test('applyThemeJsonPatch: deep-merges elements into styles.elements', async t => {
	const path = await setup(t, {
		styles: {elements: {h1: {typography: {fontWeight: '800'}}}},
	});
	const result = await applyThemeJsonPatch(path, {
		elements: {
			h1: {typography: {letterSpacing: '-0.03em'}},
			h2: {typography: {fontWeight: '700'}},
		},
	});
	t.true(result.wrote);
	t.true(result.touched.includes('styles.elements'));
	const theme = await readThemeJson(path);
	const elements = (theme.styles as Record<string, unknown>).elements as Record<
		string,
		unknown
	>;
	// Existing h1.fontWeight preserved, new letterSpacing merged in.
	t.deepEqual(elements.h1, {
		typography: {fontWeight: '800', letterSpacing: '-0.03em'},
	});
	t.deepEqual(elements.h2, {typography: {fontWeight: '700'}});
});

test('applyThemeJsonPatch: elements + blocks + custom touch all three subtrees', async t => {
	const path = await setup(t, {});
	const result = await applyThemeJsonPatch(path, {
		elements: {link: {color: {text: '#111'}}},
		blocks: {'core/separator': {color: {background: '#000'}}},
		custom: {gap: {sm: '8px'}},
	});
	t.true(result.wrote);
	t.deepEqual(result.touched.sort(), [
		'settings.custom',
		'styles.blocks',
		'styles.elements',
	]);
});

test('applyThemeJsonPatch: no-op when only-empty subtrees', async t => {
	const path = await setup(t, {});
	const result = await applyThemeJsonPatch(path, {});
	t.false(result.wrote);
});
