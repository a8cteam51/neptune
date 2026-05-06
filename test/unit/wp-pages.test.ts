import test from 'ava';
import {
	defaultTitleFromSlug,
	pageTargetFor,
	pageTargetLabel,
} from '../../source/lib/wp-pages.js';

test('pageTargetFor: simple slug', t => {
	const target = pageTargetFor('home', 'Home');
	t.is(target.slug, 'home');
	t.is(target.title, 'Home');
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

test('pageTargetLabel: formats page:slug', t => {
	t.is(pageTargetLabel({slug: 'home', title: 'Home'}), 'page:home');
});

test('defaultTitleFromSlug: kebab-case → Title Case', t => {
	t.is(defaultTitleFromSlug('about-us'), 'About Us');
	t.is(defaultTitleFromSlug('home'), 'Home');
});
