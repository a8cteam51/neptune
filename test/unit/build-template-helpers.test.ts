import test from 'ava';
import {scopeForTemplate} from '../../source/commands/build-template.js';
import {SPECIAL_META} from '../../source/commands/pull-template/special-meta.js';

test('scopeForTemplate: header role → HEADER token', t => {
	t.is(scopeForTemplate('header', false), 'HEADER');
	t.is(scopeForTemplate('header', true), 'HEADER');
});

test('scopeForTemplate: footer role → FOOTER token', t => {
	t.is(scopeForTemplate('footer', false), 'FOOTER');
	t.is(scopeForTemplate('footer', true), 'FOOTER');
});

test('scopeForTemplate: page role → PAGE without post-content, WRAPPER with', t => {
	t.is(scopeForTemplate('page', false), 'PAGE');
	t.is(scopeForTemplate('page', true), 'WRAPPER');
});

test('SPECIAL_META: stable shape for both kinds', t => {
	t.deepEqual(Object.keys(SPECIAL_META).sort(), ['styleGuide', 'templates']);
	for (const kind of ['styleGuide', 'templates'] as const) {
		const meta = SPECIAL_META[kind];
		t.is(typeof meta.pageName, 'string');
		t.is(typeof meta.slug, 'string');
		t.is(typeof meta.label, 'string');
		t.true(meta.slug.length > 0);
		t.true(/^[a-z][a-z0-9-]*$/.test(meta.slug));
	}
});

test('SPECIAL_META: slugs do not collide with each other', t => {
	const slugs = Object.values(SPECIAL_META).map(m => m.slug);
	t.is(new Set(slugs).size, slugs.length);
});
