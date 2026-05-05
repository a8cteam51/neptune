import test from 'ava';
import {
	parseCustomCss,
	serializeCustomCss,
	upsertSection,
} from '../../source/lib/custom-css-sections.js';

test('parses empty input', t => {
	const out = parseCustomCss('');
	t.is(out.sections.size, 0);
	t.is(out.preface, '');
	t.is(out.suffix, '');
});

test('parses input with no markers — all preface', t => {
	const css = '.user-css { color: red; }';
	const out = parseCustomCss(css);
	t.is(out.sections.size, 0);
	t.is(out.preface, css);
});

test('parses a single section', t => {
	const css = `/* @neptune-start core/button fill-small */
.wp-block-button.is-style-fill-small { padding: 4px; }
/* @neptune-end core/button fill-small */
`;
	const out = parseCustomCss(css);
	t.is(out.sections.size, 1);
	const section = out.sections.get('core/button::fill-small')!;
	t.is(section.block, 'core/button');
	t.is(section.style, 'fill-small');
	t.is(section.css, '.wp-block-button.is-style-fill-small { padding: 4px; }');
});

test('parses preface + multiple sections + suffix', t => {
	const css = `/* user CSS */
.foo { color: red; }

/* @neptune-start core/button fill-small */
.wp-block-button.is-style-fill-small { padding: 4px; }
/* @neptune-end core/button fill-small */
/* @neptune-start core/heading underlined */
h2.is-style-underlined { text-decoration: underline; }
/* @neptune-end core/heading underlined */

/* trailing user css */
.bar { color: blue; }`;
	const out = parseCustomCss(css);
	t.is(out.sections.size, 2);
	t.true(out.preface.includes('.foo'));
	t.true(out.suffix.includes('.bar'));
});

test('serialize round-trips parse', t => {
	const original = `/* @neptune-start core/button fill-small */
.wp-block-button.is-style-fill-small { padding: 4px; }
/* @neptune-end core/button fill-small */
`;
	const parsed = parseCustomCss(original);
	const out = serializeCustomCss(parsed);
	t.true(out.includes('@neptune-start core/button fill-small'));
	t.true(out.includes('.wp-block-button.is-style-fill-small'));
	t.true(out.includes('@neptune-end core/button fill-small'));
});

test('upsertSection: adds a new section', t => {
	const parsed = parseCustomCss('.user { color: red; }');
	const out = upsertSection(parsed, {
		block: 'core/button',
		style: 'fill',
		css: '.wp-block-button.is-style-fill { background: blue; }',
	});
	t.is(out.sections.size, 1);
	const serialized = serializeCustomCss(out);
	t.true(serialized.includes('.user { color: red; }'));
	t.true(serialized.includes('@neptune-start core/button fill'));
	t.true(serialized.includes('background: blue'));
});

test('upsertSection: replaces an existing section', t => {
	const parsed = parseCustomCss(`/* @neptune-start core/button fill */
.old { color: red; }
/* @neptune-end core/button fill */
`);
	const out = upsertSection(parsed, {
		block: 'core/button',
		style: 'fill',
		css: '.new { color: blue; }',
	});
	t.is(out.sections.size, 1);
	const serialized = serializeCustomCss(out);
	t.true(serialized.includes('.new { color: blue; }'));
	t.false(serialized.includes('.old'));
});

test('upsertSection: rejects invalid block name', t => {
	const parsed = parseCustomCss('');
	t.throws(
		() =>
			upsertSection(parsed, {
				block: 'BadBlock',
				style: 'fill',
				css: '',
			}),
		{message: /Invalid section key/},
	);
});

test('upsertSection: rejects invalid style name', t => {
	const parsed = parseCustomCss('');
	t.throws(
		() =>
			upsertSection(parsed, {
				block: 'core/button',
				style: 'NotKebab',
				css: '',
			}),
		{message: /Invalid section key/},
	);
});

test('preserves user CSS that lives between Neptune sections in the suffix', t => {
	const css = `/* @neptune-start core/button fill */
.a {}
/* @neptune-end core/button fill */
.user-after { color: red; }`;
	const parsed = parseCustomCss(css);
	const out = serializeCustomCss(parsed);
	t.true(out.includes('.user-after'));
});
