import test from 'ava';
import {parseStandardizeEnvelope} from '../../source/integrations/claude-design/standardize-envelope.js';

const BLOCK = '<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->';

test('parses a full envelope including elements', t => {
	const env = parseStandardizeEnvelope(
		JSON.stringify({
			files: {'templates/index.html': BLOCK},
			theme_json_patch: {
				elements: {h2: {typography: {letterSpacing: '-0.02em'}}},
				blocks: {'core/post-terms': {typography: {fontFamily: 'mono'}}},
			},
			block_style_variations: [
				{
					slug: 'neptune-tag',
					title: 'Tag',
					blockTypes: ['core/post-terms'],
					styles: {border: {radius: '2px'}},
				},
			],
			residual_css: 'html[data-theme="ink"]{}',
			reclassified: [{from: '.tag', to: 'variation'}],
			kept: [{rule: 'dark mode'}],
		}),
		'standardize-theme',
	);
	t.deepEqual(env.files, {'templates/index.html': BLOCK});
	t.truthy(env.theme_json_patch?.elements);
	t.truthy(env.theme_json_patch?.blocks);
	t.is(env.block_style_variations?.length, 1);
	t.is(env.residual_css, 'html[data-theme="ink"]{}');
	t.is(env.reclassified.length, 1);
	t.is(env.kept.length, 1);
});

test('allows elements where the Figma patch parser would reject it', t => {
	const env = parseStandardizeEnvelope(
		JSON.stringify({files: {}, theme_json_patch: {elements: {h1: {}}}}),
		'standardize-theme',
	);
	t.deepEqual(env.theme_json_patch, {elements: {h1: {}}});
});

test('rejects unknown theme_json_patch top-level keys', t => {
	t.throws(
		() =>
			parseStandardizeEnvelope(
				JSON.stringify({files: {}, theme_json_patch: {settings: {}}}),
				'standardize-theme',
			),
		{message: /may only contain keys: blocks, elements, custom/},
	);
});

test('rejects variations nested under blocks.<x>', t => {
	t.throws(
		() =>
			parseStandardizeEnvelope(
				JSON.stringify({
					files: {},
					theme_json_patch: {
						blocks: {'core/button': {variations: {x: {}}}},
					},
				}),
				'standardize-theme',
			),
		{message: /variations is not supported/},
	);
});

test('rejects a files value that is not block markup', t => {
	t.throws(
		() =>
			parseStandardizeEnvelope(
				JSON.stringify({files: {'templates/index.html': '<div>nope</div>'}}),
				'standardize-theme',
			),
		{message: /does not contain Gutenberg block markup/},
	);
});

test('tolerates prose around the JSON (reuses parseAgentJson recovery)', t => {
	const env = parseStandardizeEnvelope(
		'Here you go:\n' + JSON.stringify({files: {}, residual_css: 'a{}'}),
		'standardize-theme',
	);
	t.is(env.residual_css, 'a{}');
	t.deepEqual(env.files, {});
});
