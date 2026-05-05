import test from 'ava';
import {roleScopeNote} from '../../source/commands/build-template.js';
import {SPECIAL_META} from '../../source/commands/pull-template/special-meta.js';

test('roleScopeNote: header points at site title / nav', t => {
	const note = roleScopeNote('header');
	t.regex(note, /header region/i);
	t.regex(note, /Ignore main content and footer/i);
});

test('roleScopeNote: footer points at site info / copyright', t => {
	const note = roleScopeNote('footer');
	t.regex(note, /footer region/i);
	t.regex(note, /Ignore header and main content/i);
});

test('roleScopeNote: page tells the model to skip header/footer', t => {
	const note = roleScopeNote('page');
	t.regex(note, /main content region/i);
	t.regex(note, /parts\/header\.html/);
	t.regex(note, /parts\/footer\.html/);
});

test('SPECIAL_META: stable shape for all three kinds', t => {
	t.deepEqual(Object.keys(SPECIAL_META).sort(), [
		'devHandoff',
		'styleGuide',
		'templates',
	]);
	for (const kind of ['devHandoff', 'styleGuide', 'templates'] as const) {
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
