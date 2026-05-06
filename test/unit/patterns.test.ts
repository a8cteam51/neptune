import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {
	formatRegisteredPatternsContext,
	kebabFromPascalCase,
	listPatternSources,
	listRegisteredPatterns,
	parsePatternEnvelope,
	serializePatternPhp,
	writePatternFile,
} from '../../source/lib/patterns.js';
import {makeTmpDir} from '../helpers/tmp.js';

test('kebabFromPascalCase: simple PascalCase', t => {
	t.is(kebabFromPascalCase('HeroCallout'), 'hero-callout');
});

test('kebabFromPascalCase: trailing acronym', t => {
	t.is(kebabFromPascalCase('SimpleCTA'), 'simple-cta');
});

test('kebabFromPascalCase: leading acronym', t => {
	t.is(kebabFromPascalCase('CTASection'), 'cta-section');
});

test('kebabFromPascalCase: numbers stay attached', t => {
	t.is(kebabFromPascalCase('Hero2Column'), 'hero2-column');
});

test('kebabFromPascalCase: snake_case gets normalized', t => {
	t.is(kebabFromPascalCase('hero_callout'), 'hero-callout');
});

test('kebabFromPascalCase: already kebab', t => {
	t.is(kebabFromPascalCase('hero-callout'), 'hero-callout');
});

test('kebabFromPascalCase: empty input', t => {
	t.is(kebabFromPascalCase(''), '');
	t.is(kebabFromPascalCase('   '), '');
});

test('parsePatternEnvelope: minimum-viable envelope', t => {
	const env = parsePatternEnvelope(
		JSON.stringify({
			title: 'Hero',
			template_html: '<!-- wp:group --><!-- /wp:group -->',
		}),
	);
	t.is(env.title, 'Hero');
	t.is(env.template_html, '<!-- wp:group --><!-- /wp:group -->');
	t.is(env.categories, undefined);
	t.is(env.inserter, undefined);
});

test('parsePatternEnvelope: rejects empty title', t => {
	t.throws(
		() =>
			parsePatternEnvelope(
				JSON.stringify({title: '   ', template_html: '<!-- wp:group /-->'}),
			),
		{message: /non-empty title/},
	);
});

test('parsePatternEnvelope: rejects missing template_html', t => {
	t.throws(() => parsePatternEnvelope(JSON.stringify({title: 'X'})), {
		message: /template_html/,
	});
});

test('parsePatternEnvelope: rejects non-kebab category', t => {
	t.throws(
		() =>
			parsePatternEnvelope(
				JSON.stringify({
					title: 'X',
					template_html: '<!-- wp:group /-->',
					categories: ['Featured Hero'],
				}),
			),
		{message: /must be kebab-case/},
	);
});

test('parsePatternEnvelope: rejects non-positive viewport_width', t => {
	t.throws(
		() =>
			parsePatternEnvelope(
				JSON.stringify({
					title: 'X',
					template_html: '<!-- wp:group /-->',
					viewport_width: 0,
				}),
			),
		{message: /positive integer/},
	);
});

test('parsePatternEnvelope: passes through full metadata', t => {
	const env = parsePatternEnvelope(
		JSON.stringify({
			title: 'Hero callout',
			description: '  Bold heading.  ',
			categories: ['featured', 'hero'],
			keywords: ['hero', 'banner'],
			block_types: ['core/post-content'],
			viewport_width: 1280,
			inserter: false,
			template_html: '<!-- wp:group --><!-- /wp:group -->',
			block_style_variations: [
				{
					slug: 'neptune-fill',
					title: 'Fill',
					blockTypes: ['core/button'],
					styles: {color: {background: '#000'}},
				},
			],
		}),
	);
	t.is(env.title, 'Hero callout');
	t.is(env.description, 'Bold heading.');
	t.deepEqual(env.categories, ['featured', 'hero']);
	t.deepEqual(env.keywords, ['hero', 'banner']);
	t.deepEqual(env.block_types, ['core/post-content']);
	t.is(env.viewport_width, 1280);
	t.is(env.inserter, false);
	t.is(env.block_style_variations?.length, 1);
});

test('serializePatternPhp: emits header + body for the minimum envelope', t => {
	const php = serializePatternPhp({
		themeSlug: 'neptune-theme',
		slug: 'hero',
		envelope: {
			title: 'Hero',
			template_html: '<!-- wp:group --><!-- /wp:group -->',
		},
	});
	t.true(php.startsWith('<?php\n/**\n'));
	t.true(php.includes(' * Title: Hero\n'));
	t.true(php.includes(' * Slug: neptune-theme/hero\n'));
	t.true(php.endsWith('<!-- wp:group --><!-- /wp:group -->\n'));
});

test('serializePatternPhp: includes optional headers when present', t => {
	const php = serializePatternPhp({
		themeSlug: 'neptune-theme',
		slug: 'hero',
		envelope: {
			title: 'Hero',
			description: 'Bold heading.',
			categories: ['featured', 'hero'],
			keywords: ['hero', 'banner'],
			block_types: ['core/post-content'],
			viewport_width: 1280,
			inserter: false,
			template_html: '<!-- wp:group /-->',
		},
	});
	t.true(php.includes(' * Categories: featured, hero\n'));
	t.true(php.includes(' * Keywords: hero, banner\n'));
	t.true(php.includes(' * Block Types: core/post-content\n'));
	t.true(php.includes(' * Viewport Width: 1280\n'));
	t.true(php.includes(' * Inserter: no\n'));
	t.true(php.includes(' * Description: Bold heading.\n'));
});

test('serializePatternPhp: omits inserter header when default-true', t => {
	const php = serializePatternPhp({
		themeSlug: 't',
		slug: 's',
		envelope: {title: 'T', template_html: '<!-- wp:group /-->', inserter: true},
	});
	t.false(php.includes('Inserter:'));
});

test('serializePatternPhp: omits empty optional arrays', t => {
	const php = serializePatternPhp({
		themeSlug: 't',
		slug: 's',
		envelope: {
			title: 'T',
			template_html: '<!-- wp:group /-->',
			categories: [],
			keywords: [],
			block_types: [],
		},
	});
	t.false(php.includes('Categories:'));
	t.false(php.includes('Keywords:'));
	t.false(php.includes('Block Types:'));
});

test('listPatternSources: returns [] when patterns/ is missing', async t => {
	const dir = await makeTmpDir(t);
	t.deepEqual(await listPatternSources(dir), []);
});

test('listPatternSources: lists every patterns/<Name>/code.tsx alphabetically', async t => {
	const dir = await makeTmpDir(t);
	const patternsDir = join(dir, 'patterns');
	await mkdir(join(patternsDir, 'HeroCallout'), {recursive: true});
	await writeFile(
		join(patternsDir, 'HeroCallout', 'code.tsx'),
		'export function HeroCallout() {return null}',
		'utf8',
	);
	await mkdir(join(patternsDir, 'CTASection'), {recursive: true});
	await writeFile(
		join(patternsDir, 'CTASection', 'code.tsx'),
		'export function CTASection() {return null}',
		'utf8',
	);
	// Folder without a code.tsx is ignored.
	await mkdir(join(patternsDir, 'EmptyFolder'), {recursive: true});
	// Stray file at the root is ignored.
	await writeFile(join(patternsDir, 'README.md'), 'ignored', 'utf8');
	const sources = await listPatternSources(dir);
	t.is(sources.length, 2);
	t.deepEqual(
		sources.map(s => s.name),
		['CTASection', 'HeroCallout'],
	);
	t.true(sources[0]!.path.endsWith(join('CTASection', 'code.tsx')));
});

test('writePatternFile: creates patterns/ and writes atomically', async t => {
	const themePath = await makeTmpDir(t);
	const path = await writePatternFile(themePath, 'hero', '<?php // hi\n');
	t.is(path, join(themePath, 'patterns', 'hero.php'));
	const body = await readFile(path, 'utf8');
	t.is(body, '<?php // hi\n');
});

// listRegisteredPatterns: returns patterns that have BOTH an on-disk
// folder under <project>/patterns/<Name>/ AND a built PHP file at
// wordpress/wp-content/themes/<themeSlug>/patterns/<kebab>.php. Anything
// satisfying only one half is excluded.

test('listRegisteredPatterns: returns [] when patterns/ is missing', async t => {
	const dir = await makeTmpDir(t);
	t.deepEqual(await listRegisteredPatterns(dir, 'neptune-theme'), []);
});

test('listRegisteredPatterns: returns [] when no PHP files exist', async t => {
	const dir = await makeTmpDir(t);
	const patternsDir = join(dir, 'patterns');
	await mkdir(join(patternsDir, 'HeroCallout'), {recursive: true});
	await writeFile(
		join(patternsDir, 'HeroCallout', 'code.tsx'),
		'export function HeroCallout() {return null}',
		'utf8',
	);
	t.deepEqual(await listRegisteredPatterns(dir, 'neptune-theme'), []);
});

test('listRegisteredPatterns: returns only patterns with both folder and PHP', async t => {
	const dir = await makeTmpDir(t);
	const patternsDir = join(dir, 'patterns');
	const themePatternsDir = join(
		dir,
		'wordpress',
		'wp-content',
		'themes',
		'neptune-theme',
		'patterns',
	);
	await mkdir(join(patternsDir, 'HeroCallout'), {recursive: true});
	await writeFile(
		join(patternsDir, 'HeroCallout', 'code.tsx'),
		'export function HeroCallout() {return null}',
		'utf8',
	);
	await mkdir(join(patternsDir, 'CTASection'), {recursive: true});
	await writeFile(
		join(patternsDir, 'CTASection', 'code.tsx'),
		'export function CTASection() {return null}',
		'utf8',
	);
	await mkdir(join(patternsDir, 'PulledButNotBuilt'), {recursive: true});
	await mkdir(themePatternsDir, {recursive: true});
	// HeroCallout is built; CTASection is not.
	await writeFile(
		join(themePatternsDir, 'hero-callout.php'),
		'<?php // hi\n',
		'utf8',
	);
	// Stray PHP without a folder counterpart should NOT appear.
	await writeFile(
		join(themePatternsDir, 'orphan-php.php'),
		'<?php // hi\n',
		'utf8',
	);
	const result = await listRegisteredPatterns(dir, 'neptune-theme');
	t.is(result.length, 1);
	t.is(result[0]!.name, 'HeroCallout');
	t.is(result[0]!.slug, 'neptune-theme/hero-callout');
});

test('listRegisteredPatterns: ignores dotfiles and non-folders', async t => {
	const dir = await makeTmpDir(t);
	const patternsDir = join(dir, 'patterns');
	const themePatternsDir = join(
		dir,
		'wordpress',
		'wp-content',
		'themes',
		'neptune-theme',
		'patterns',
	);
	await mkdir(patternsDir, {recursive: true});
	await mkdir(themePatternsDir, {recursive: true});
	// .hidden folder is skipped.
	await mkdir(join(patternsDir, '.hidden'), {recursive: true});
	await writeFile(
		join(themePatternsDir, 'hidden.php'),
		'<?php // hi\n',
		'utf8',
	);
	// Stray file at the patterns/ root is skipped.
	await writeFile(join(patternsDir, 'README.md'), 'ignored', 'utf8');
	const result = await listRegisteredPatterns(dir, 'neptune-theme');
	t.deepEqual(result, []);
});

test('formatRegisteredPatternsContext: returns null on empty input', t => {
	t.is(formatRegisteredPatternsContext([]), null);
});

test('formatRegisteredPatternsContext: emits compact JSON of name + slug', t => {
	const out = formatRegisteredPatternsContext([
		{name: 'HeroCallout', slug: 'neptune-theme/hero-callout'},
		{name: 'CTASection', slug: 'neptune-theme/cta-section'},
	]);
	t.truthy(out);
	const parsed = JSON.parse(out!);
	t.deepEqual(parsed, [
		{name: 'HeroCallout', slug: 'neptune-theme/hero-callout'},
		{name: 'CTASection', slug: 'neptune-theme/cta-section'},
	]);
});
