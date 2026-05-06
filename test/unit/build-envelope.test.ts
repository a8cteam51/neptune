import test from 'ava';
import {
	parseAgentJson,
	parseBlockStyleVariationsField,
	parseBuildEnvelope,
	parseThemeJsonPatchField,
} from '../../source/lib/build-envelope.js';

test('parseAgentJson: round-trips valid JSON', t => {
	const v = parseAgentJson('{"a":1}', 'x');
	t.deepEqual(v, {a: 1});
});

test('parseAgentJson: throws with label + preview on invalid JSON', t => {
	t.throws(
		() => parseAgentJson('not json at all', 'tsx-to-blocks'),
		{message: /tsx-to-blocks response was not valid JSON/},
	);
});

test('parseBuildEnvelope: minimum valid envelope', t => {
	const env = parseBuildEnvelope(
		JSON.stringify({template_html: '<!-- wp:group -->x<!-- /wp:group -->'}),
		'build-template',
	);
	t.is(env.template_html, '<!-- wp:group -->x<!-- /wp:group -->');
	t.is(env.theme_json_patch, undefined);
});

test('parseBuildEnvelope: with theme_json_patch.blocks', t => {
	const env = parseBuildEnvelope(
		JSON.stringify({
			template_html: '<!-- wp:p -->t<!-- /wp:p -->',
			theme_json_patch: {
				blocks: {'core/paragraph': {color: {text: '#000'}}},
			},
		}),
		'build-template',
	);
	t.deepEqual(env.theme_json_patch, {
		blocks: {'core/paragraph': {color: {text: '#000'}}},
	});
});

test('parseBuildEnvelope: rejects non-object response', t => {
	t.throws(() => parseBuildEnvelope('[]', 'build-template'), {
		message: /response is not a JSON object/,
	});
});

test('parseBuildEnvelope: rejects empty template_html', t => {
	t.throws(
		() =>
			parseBuildEnvelope(
				JSON.stringify({template_html: ''}),
				'build-template',
			),
		{message: /missing a non-empty template_html/},
	);
});

test('parseThemeJsonPatchField: undefined / null → undefined', t => {
	t.is(parseThemeJsonPatchField(undefined, 'x'), undefined);
	t.is(parseThemeJsonPatchField(null, 'x'), undefined);
});

test('parseThemeJsonPatchField: rejects extra top-level keys', t => {
	t.throws(
		() =>
			parseThemeJsonPatchField(
				{blocks: {}, settings: {color: {}}},
				'build-template',
			),
		{message: /may only contain keys: blocks, custom.*Got extra: settings/},
	);
});

test('parseThemeJsonPatchField: rejects array as patch', t => {
	t.throws(() => parseThemeJsonPatchField([], 'build-template'), {
		message: /must be a JSON object/,
	});
});

test('parseThemeJsonPatchField: rejects non-object blocks', t => {
	t.throws(
		() => parseThemeJsonPatchField({blocks: 'oops'}, 'build-template'),
		{message: /\.blocks must be an object/},
	);
});

test('parseThemeJsonPatchField: rejects non-object custom', t => {
	t.throws(
		() => parseThemeJsonPatchField({custom: 42}, 'build-template'),
		{message: /\.custom must be an object/},
	);
});

test('parseThemeJsonPatchField: empty patch object → undefined', t => {
	t.is(parseThemeJsonPatchField({}, 'x'), undefined);
});

test('parseThemeJsonPatchField: returns only requested subtrees', t => {
	const v = parseThemeJsonPatchField(
		{blocks: {'core/p': {}}, custom: {x: 1}},
		'x',
	);
	t.deepEqual(v, {blocks: {'core/p': {}}, custom: {x: 1}});
});

test('parseThemeJsonPatchField: rejects variations under blocks.<x>', t => {
	t.throws(
		() =>
			parseThemeJsonPatchField(
				{
					blocks: {
						'core/button': {variations: {'neptune-x': {css: '.x{}'}}},
					},
				},
				'build-template',
			),
		{
			message:
				/blocks\["core\/button"\]\.variations is not supported.*block_style_variations/,
		},
	);
});

test('parseThemeJsonPatchField: allows non-variation children of blocks.<x>', t => {
	const v = parseThemeJsonPatchField(
		{
			blocks: {
				'core/button': {color: {text: '#000'}, css: '.x{}'},
			},
		},
		'x',
	);
	t.truthy(v?.blocks);
});

test('parseBlockStyleVariationsField: undefined / null → undefined', t => {
	t.is(parseBlockStyleVariationsField(undefined, 'x'), undefined);
	t.is(parseBlockStyleVariationsField(null, 'x'), undefined);
});

test('parseBlockStyleVariationsField: rejects non-array', t => {
	t.throws(() => parseBlockStyleVariationsField({}, 'x'), {
		message: /must be an array/,
	});
});

test('parseBlockStyleVariationsField: empty array → undefined', t => {
	t.is(parseBlockStyleVariationsField([], 'x'), undefined);
});

test('parseBlockStyleVariationsField: parses a valid entry', t => {
	const v = parseBlockStyleVariationsField(
		[
			{
				slug: 'neptune-fill-small',
				title: 'Fill Small',
				blockTypes: ['core/button'],
				styles: {spacing: {padding: '8px'}},
			},
		],
		'x',
	);
	t.is(v?.length, 1);
	t.is(v?.[0]!.slug, 'neptune-fill-small');
	t.deepEqual(v?.[0]!.blockTypes, ['core/button']);
});

test('parseBlockStyleVariationsField: rejects slug missing neptune- prefix', t => {
	t.throws(
		() =>
			parseBlockStyleVariationsField(
				[
					{
						slug: 'fill-small',
						title: 'X',
						blockTypes: ['core/button'],
						styles: {},
					},
				],
				'x',
			),
		{message: /must be a kebab-case string starting with "neptune-"/},
	);
});

test('parseBlockStyleVariationsField: rejects empty title', t => {
	t.throws(
		() =>
			parseBlockStyleVariationsField(
				[
					{
						slug: 'neptune-x',
						title: '',
						blockTypes: ['core/button'],
						styles: {},
					},
				],
				'x',
			),
		{message: /title must be a non-empty string/},
	);
});

test('parseBlockStyleVariationsField: rejects empty blockTypes', t => {
	t.throws(
		() =>
			parseBlockStyleVariationsField(
				[
					{
						slug: 'neptune-x',
						title: 'X',
						blockTypes: [],
						styles: {},
					},
				],
				'x',
			),
		{message: /blockTypes must be a non-empty array/},
	);
});

test('parseBlockStyleVariationsField: rejects bad block name shape', t => {
	t.throws(
		() =>
			parseBlockStyleVariationsField(
				[
					{
						slug: 'neptune-x',
						title: 'X',
						blockTypes: ['notvalid'],
						styles: {},
					},
				],
				'x',
			),
		{message: /must match <vendor>\/<block-name>/},
	);
});

test('parseBlockStyleVariationsField: rejects non-object styles', t => {
	t.throws(
		() =>
			parseBlockStyleVariationsField(
				[
					{
						slug: 'neptune-x',
						title: 'X',
						blockTypes: ['core/button'],
						styles: 'oops',
					},
				],
				'x',
			),
		{message: /styles must be an object/},
	);
});

test('parseBlockStyleVariationsField: rejects duplicate slugs in same envelope', t => {
	t.throws(
		() =>
			parseBlockStyleVariationsField(
				[
					{
						slug: 'neptune-x',
						title: 'A',
						blockTypes: ['core/button'],
						styles: {},
					},
					{
						slug: 'neptune-x',
						title: 'B',
						blockTypes: ['core/button'],
						styles: {},
					},
				],
				'x',
			),
		{message: /slug "neptune-x" is duplicated/},
	);
});

test('parseBuildEnvelope: includes block_style_variations when present', t => {
	const env = parseBuildEnvelope(
		JSON.stringify({
			template_html: '<!-- wp:p -->t<!-- /wp:p -->',
			block_style_variations: [
				{
					slug: 'neptune-fill-small',
					title: 'Fill Small',
					blockTypes: ['core/button'],
					styles: {},
				},
			],
		}),
		'build-template',
	);
	t.is(env.block_style_variations?.length, 1);
});
