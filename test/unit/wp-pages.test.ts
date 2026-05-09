import test from 'ava';
import {
	defaultTitleFromSlug,
	pageTargetFor,
	pageTargetLabel,
} from '../../source/lib/wp-pages.js';

test('pageTargetFor: simple slug defaults to page type', t => {
	const target = pageTargetFor('home', 'Home');
	t.is(target.slug, 'home');
	t.is(target.title, 'Home');
	t.is(target.postType, 'page');
});

test('pageTargetFor: kebab-case slug stays as-is', t => {
	const target = pageTargetFor('about-us', 'About');
	t.is(target.slug, 'about-us');
	t.is(target.title, 'About');
});

test('pageTargetFor: empty pageName falls back to slug-derived title', t => {
	const target = pageTargetFor('about-us', '');
	t.is(target.title, 'About Us');
});

test('pageTargetFor: leading-digit slug is allowed', t => {
	const target = pageTargetFor('404', 'Not Found');
	t.is(target.slug, '404');
	t.is(target.title, 'Not Found');
});

test('pageTargetFor: rejects invalid slug shapes', t => {
	t.throws(() => pageTargetFor('Has Spaces', 'X'), {
		message: /does not match/i,
	});
	t.throws(() => pageTargetFor('-leading-dash', 'X'), {
		message: /does not match/i,
	});
	t.throws(() => pageTargetFor('UPPER', 'X'), {message: /does not match/i});
});

test('pageTargetFor: post type opt-in for single.html flow', t => {
	const target = pageTargetFor('hello-world', 'Hello World', 'post');
	t.is(target.slug, 'hello-world');
	t.is(target.postType, 'post');
});

test('pageTargetLabel: formats <postType>:<slug>', t => {
	t.is(
		pageTargetLabel({slug: 'home', title: 'Home', postType: 'page'}),
		'page:home',
	);
	t.is(
		pageTargetLabel({
			slug: 'hello-world',
			title: 'Hello World',
			postType: 'post',
		}),
		'post:hello-world',
	);
});

test('defaultTitleFromSlug: kebab-case → Title Case', t => {
	t.is(defaultTitleFromSlug('about-us'), 'About Us');
	t.is(defaultTitleFromSlug('home'), 'Home');
});
