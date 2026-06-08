import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {
	previewPathForTemplate,
	targetFor,
	validateClaudeDesignDir,
} from '../../source/integrations/claude-design/contract.js';
import {makeTmpDir} from '../helpers/tmp.js';

const BLOCK = '<!-- wp:paragraph -->\n<p>hi</p>\n<!-- /wp:paragraph -->\n';

type PackageOverrides = {
	themeJson?: unknown | null; // null ⇒ omit the file
	templates?: Record<string, string>; // name → contents (omit ⇒ default)
	parts?: Record<string, string>;
	style?: string | null;
	assets?: Record<string, string>;
	staticRefs?: string[]; // top-level <name>.html files to create
};

async function buildPackage(
	t: import('ava').ExecutionContext,
	o: PackageOverrides = {},
): Promise<string> {
	const dir = await makeTmpDir(t);
	if (o.themeJson !== null) {
		const body = o.themeJson ?? {
			version: 3,
			settings: {layout: {wideSize: '1100px'}},
		};
		await writeFile(join(dir, 'theme.json'), JSON.stringify(body), 'utf8');
	}
	const templates = o.templates ?? {'index.html': BLOCK, 'single.html': BLOCK};
	if (Object.keys(templates).length > 0) {
		await mkdir(join(dir, 'templates'), {recursive: true});
		for (const [name, body] of Object.entries(templates)) {
			await writeFile(join(dir, 'templates', name), body, 'utf8');
		}
	}
	const parts = o.parts ?? {'footer.html': BLOCK, 'sidebar.html': BLOCK};
	if (Object.keys(parts).length > 0) {
		await mkdir(join(dir, 'parts'), {recursive: true});
		for (const [name, body] of Object.entries(parts)) {
			await writeFile(join(dir, 'parts', name), body, 'utf8');
		}
	}
	if (o.style !== null) {
		await writeFile(join(dir, 'style.css'), o.style ?? ':root{}', 'utf8');
	}
	const assets = o.assets ?? {'theme.js': '/*js*/'};
	if (Object.keys(assets).length > 0) {
		await mkdir(join(dir, 'assets'), {recursive: true});
		for (const [name, body] of Object.entries(assets)) {
			await writeFile(join(dir, 'assets', name), body, 'utf8');
		}
	}
	const refs = o.staticRefs ?? ['index.html', 'single.html'];
	for (const name of refs) {
		await writeFile(join(dir, name), '<!doctype html><html></html>', 'utf8');
	}
	return dir;
}

test('validate: a well-formed package enumerates templates/parts/refs/assets', async t => {
	const dir = await buildPackage(t);
	const v = await validateClaudeDesignDir(dir);
	t.true(v.ok);
	t.truthy(v.manifest);
	const m = v.manifest!;
	t.deepEqual(m.templates, ['index.html', 'single.html']);
	t.deepEqual(m.parts, ['footer.html', 'sidebar.html']);
	t.deepEqual(Object.keys(m.staticRefs).sort(), ['index.html', 'single.html']);
	t.truthy(m.styleCssPath);
	t.deepEqual(m.scriptAssets, ['theme.js']);
});

test('validate: missing theme.json is a fatal error', async t => {
	const dir = await buildPackage(t, {themeJson: null});
	const v = await validateClaudeDesignDir(dir);
	t.false(v.ok);
	t.is(v.manifest, null);
	t.true(v.errors.some(e => /theme\.json/i.test(e)));
});

test('validate: no block-markup templates is a fatal error', async t => {
	const dir = await buildPackage(t, {templates: {}});
	const v = await validateClaudeDesignDir(dir);
	t.false(v.ok);
	t.true(v.errors.some(e => /templates/i.test(e)));
});

test('validate: a non-block-markup template is skipped with a warning', async t => {
	const dir = await buildPackage(t, {
		templates: {'index.html': BLOCK, 'raw.html': '<div>not blocks</div>'},
	});
	const v = await validateClaudeDesignDir(dir);
	t.true(v.ok);
	t.deepEqual(v.manifest!.templates, ['index.html']);
	t.true(v.warnings.some(w => /raw\.html/.test(w)));
});

test('validate: theme.json v2 warns but still validates', async t => {
	const dir = await buildPackage(t, {themeJson: {version: 2, settings: {}}});
	const v = await validateClaudeDesignDir(dir);
	t.true(v.ok);
	t.true(v.warnings.some(w => /version/i.test(w)));
});

test('validate: a template with no static reference warns', async t => {
	const dir = await buildPackage(t, {
		templates: {'index.html': BLOCK, 'archive.html': BLOCK},
		staticRefs: ['index.html'],
	});
	const v = await validateClaudeDesignDir(dir);
	t.true(v.ok);
	t.false('archive.html' in v.manifest!.staticRefs);
	t.true(v.warnings.some(w => /archive\.html/.test(w)));
});

test('targetFor: routes by source dir, not filename', t => {
	t.deepEqual(targetFor('template', 'index.html'), {
		slug: 'index',
		type: 'wp_template',
		title: 'Index',
	});
	// A part can be named anything — it still routes to wp_template_part.
	t.deepEqual(targetFor('part', 'sidebar.html'), {
		slug: 'sidebar',
		type: 'wp_template_part',
		title: 'Sidebar',
	});
});

test('previewPathForTemplate: known templates resolve, unknown fall back to /', t => {
	t.deepEqual(previewPathForTemplate('index'), {path: '/', known: true});
	t.deepEqual(previewPathForTemplate('single'), {path: '/?p=1', known: true});
	t.is(previewPathForTemplate('archive').path, '/');
	t.false(previewPathForTemplate('archive').known);
});
