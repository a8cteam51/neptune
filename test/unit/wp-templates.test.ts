import test from 'ava';
import {
	defaultTitleFromSlug,
	targetLabel,
	templateTargetFor,
} from '../../source/lib/wp-templates.js';

test('templateTargetFor: index.html → wp_template:index', t => {
	const t1 = templateTargetFor('index.html', 'Home');
	t.is(t1.slug, 'index');
	t.is(t1.type, 'wp_template');
	t.is(t1.title, 'Home');
});

test('templateTargetFor: header.html → wp_template_part:header', t => {
	const t1 = templateTargetFor('header.html', 'Header');
	t.is(t1.slug, 'header');
	t.is(t1.type, 'wp_template_part');
	t.is(t1.title, 'Header');
});

test('templateTargetFor: footer.html → wp_template_part:footer', t => {
	const t1 = templateTargetFor('footer.html', 'Footer');
	t.is(t1.slug, 'footer');
	t.is(t1.type, 'wp_template_part');
});

test('templateTargetFor: kebab-case stays in slug', t => {
	const t1 = templateTargetFor('single-product.html', 'Product');
	t.is(t1.slug, 'single-product');
	t.is(t1.type, 'wp_template');
});

test('templateTargetFor: 404.html is a valid template slug', t => {
	const t1 = templateTargetFor('404.html', 'Not Found');
	t.is(t1.slug, '404');
	t.is(t1.type, 'wp_template');
	t.is(t1.title, 'Not Found');
});

test('templateTargetFor: empty pageName falls back to slug-derived title', t => {
	const t1 = templateTargetFor('single-product.html', '');
	t.is(t1.title, 'Single Product');
});

test('templateTargetFor: rejects non-html files', t => {
	// .html extension is required to land in templates/parts subdirs;
	// templateTargetFor only sees a slug after .html strip, but
	// extension-less inputs produce a slug from the whole filename.
	t.throws(
		() => templateTargetFor('Not_A_Slug.html', 'Bad'),
		{message: /does not produce a valid slug/i},
	);
});

test('targetLabel: formats type:slug', t => {
	t.is(
		targetLabel({slug: 'index', type: 'wp_template', title: 'Home'}),
		'wp_template:index',
	);
	t.is(
		targetLabel({
			slug: 'header',
			type: 'wp_template_part',
			title: 'Header',
		}),
		'wp_template_part:header',
	);
});

test('defaultTitleFromSlug: kebab-case → Title Case', t => {
	t.is(defaultTitleFromSlug('single-product'), 'Single Product');
	t.is(defaultTitleFromSlug('index'), 'Index');
	t.is(defaultTitleFromSlug('a-b-c'), 'A B C');
});

test('defaultTitleFromSlug: handles snake_case too', t => {
	t.is(defaultTitleFromSlug('hello_world'), 'Hello World');
});
