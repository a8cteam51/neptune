// Tests for the End-to-end build pre-flight check. Builds an on-disk
// project skeleton via makeTmpDir + helper functions, then exercises
// each missing-prereq path and confirms checkPrereqs returns the
// expected error messages and plan partitioning.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'ava';
import {checkPrereqs} from '../../source/commands/e2e-prereqs.js';
import type {Loaded} from '../../source/commands/setup-project/types.js';
import type {PullMeta} from '../../source/lib/types.js';
import {makeTmpDir} from '../helpers/tmp.js';

type ConfigOverrides = Partial<Loaded['config']>;

async function setupProject(
	dir: string,
	overrides: ConfigOverrides = {},
): Promise<Loaded> {
	return {
		dir,
		configPath: join(dir, 'neptune-config.json'),
		mode: 'continued',
		config: {
			createdAt: '2026-05-06T00:00:00Z',
			updatedAt: '2026-05-06T00:00:00Z',
			design: {pagesDir: 'design'},
			steps: {
				initialized: true,
				projectNamed: true,
				gitRepoConfigured: true,
				themeConfigured: true,
				wordpressInstalled: true,
				wpContentCloned: true,
				studioSiteCreated: true,
				placeholderUploaded: true,
			},
			...overrides,
		},
	};
}

async function writePullMeta(
	dir: string,
	meta: PullMeta,
): Promise<void> {
	const pullDir = join(dir, 'design', meta.slug);
	await mkdir(pullDir, {recursive: true});
	await writeFile(
		join(pullDir, 'meta.json'),
		JSON.stringify(meta, null, 2) + '\n',
		'utf8',
	);
}

async function writePatternSource(dir: string, name: string): Promise<void> {
	const folder = join(dir, 'patterns', name);
	await mkdir(folder, {recursive: true});
	await writeFile(
		join(folder, 'code.tsx'),
		`export function ${name}() {return null}`,
		'utf8',
	);
}

test('checkPrereqs: flags missing themeSlug', async t => {
	const dir = await makeTmpDir(t);
	const loaded = await setupProject(dir, {themeSlug: undefined});
	await writePullMeta(dir, {
		pageName: 'Home',
		slug: 'home',
		templateFile: 'index.html',
		pulledAt: '2026-05-06T00:00:00Z',
	});
	const {missing} = await checkPrereqs(loaded);
	t.true(missing.some(m => m.includes('themeSlug')));
});

test('checkPrereqs: flags missing pulls', async t => {
	const dir = await makeTmpDir(t);
	const loaded = await setupProject(dir, {themeSlug: 'neptune-theme'});
	const {missing, plan} = await checkPrereqs(loaded);
	t.true(missing.some(m => m.includes('No non-special pulls')));
	t.deepEqual(plan.contentPulls, []);
	t.deepEqual(plan.templatePulls, []);
	t.deepEqual(plan.patternSources, []);
});

test('checkPrereqs: flags pattern selected without folder', async t => {
	const dir = await makeTmpDir(t);
	const loaded = await setupProject(dir, {
		themeSlug: 'neptune-theme',
		patterns: ['HeroCallout', 'CTASection'],
	});
	await writePullMeta(dir, {
		pageName: 'Home',
		slug: 'home',
		templateFile: 'index.html',
		pulledAt: '2026-05-06T00:00:00Z',
	});
	await writePatternSource(dir, 'HeroCallout');
	// CTASection is selected but never pulled.
	const {missing, plan} = await checkPrereqs(loaded);
	t.true(
		missing.some(
			m => m.includes('CTASection') && m.includes('not been pulled'),
		),
		`expected missing-pull complaint for CTASection, got: ${missing.join('|')}`,
	);
	t.is(plan.patternSources.length, 1);
	t.is(plan.patternSources[0]!.name, 'HeroCallout');
});

test('checkPrereqs: returns no missing on a fully-set-up project', async t => {
	const dir = await makeTmpDir(t);
	const loaded = await setupProject(dir, {
		themeSlug: 'neptune-theme',
		patterns: ['HeroCallout'],
	});
	await writePullMeta(dir, {
		pageName: 'Home',
		slug: 'home',
		templateFile: 'index.html',
		pulledAt: '2026-05-06T00:00:00Z',
	});
	await writePatternSource(dir, 'HeroCallout');
	const {missing, plan} = await checkPrereqs(loaded);
	t.deepEqual(missing, []);
	t.is(plan.templatePulls.length, 1);
	t.is(plan.templatePulls[0]!.slug, 'home');
	t.is(plan.contentPulls.length, 0);
	t.is(plan.patternSources.length, 1);
});

test('checkPrereqs: partitions content vs template pulls correctly', async t => {
	const dir = await makeTmpDir(t);
	const loaded = await setupProject(dir, {themeSlug: 'neptune-theme'});
	// Wrapper template (build-templates only)
	await writePullMeta(dir, {
		pageName: 'About',
		slug: 'about',
		templateFile: 'page.html',
		pulledAt: '2026-05-06T00:00:00Z',
	});
	// usesPostContent template + content (appears in both)
	await writePullMeta(dir, {
		pageName: 'Home',
		slug: 'home',
		templateFile: 'front-page.html',
		pageSlug: 'home',
		usesPostContent: true,
		pulledAt: '2026-05-06T00:00:00Z',
	});
	// Content-only pull contributes to content but skips template build
	await writePullMeta(dir, {
		pageName: 'Blog',
		slug: 'blog',
		templateFile: 'index.html',
		pageSlug: 'blog',
		usesPostContent: true,
		contentOnly: true,
		pulledAt: '2026-05-06T00:00:00Z',
	});
	const {plan} = await checkPrereqs(loaded);
	t.deepEqual(
		plan.templatePulls.map(p => p.slug).sort(),
		['about', 'home'],
		'contentOnly pull excluded from templates',
	);
	t.deepEqual(
		plan.contentPulls.map(p => p.slug).sort(),
		['blog', 'home'],
	);
});

test('checkPrereqs: skips special pulls', async t => {
	const dir = await makeTmpDir(t);
	const loaded = await setupProject(dir, {themeSlug: 'neptune-theme'});
	await writePullMeta(dir, {
		pageName: 'Style Guide',
		slug: 'style-guide',
		special: 'styleGuide',
		pulledAt: '2026-05-06T00:00:00Z',
	});
	await writePullMeta(dir, {
		pageName: 'Templates',
		slug: 'templates',
		special: 'templates',
		pulledAt: '2026-05-06T00:00:00Z',
	});
	const {missing} = await checkPrereqs(loaded);
	// Specials don't count as non-special pulls; the "no pulls" complaint
	// should still fire.
	t.true(missing.some(m => m.includes('No non-special pulls')));
});
