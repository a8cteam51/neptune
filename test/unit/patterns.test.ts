import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {
	formatRegisteredPatternsContext,
	kebabFromPascalCase,
	listPatternSources,
	listRegisteredPatterns,
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
