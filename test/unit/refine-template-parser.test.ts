import test from 'ava';
import {
	parseApplyEnvelope,
	parseDiffReport,
	validateApplyCoverage,
} from '../../source/commands/refine-template.js';

test('parses a valid report', t => {
	const input = JSON.stringify({
		summary: 'Hero heading wrong block, footer spacing too tight',
		matches_design: false,
		diffs: [
			{
				id: 'hero-heading-level',
				region: 'Hero',
				severity: 'high',
				description: 'Heading is wp:paragraph; design is h1',
				block_change: 'wp:paragraph → wp:heading level=1',
				affects_layout: false,
			},
			{
				id: 'footer-spacing',
				region: 'Footer',
				severity: 'low',
				description: 'Padding too tight',
				style_change: 'spacing/sm → spacing/md',
				affects_layout: true,
			},
		],
	});
	const r = parseDiffReport(input);
	t.is(r.summary, 'Hero heading wrong block, footer spacing too tight');
	t.false(r.matches_design);
	t.is(r.diffs.length, 2);
	t.is(r.diffs[0]!.id, 'hero-heading-level');
	t.is(r.diffs[0]!.severity, 'high');
	t.is(r.diffs[1]!.style_change, 'spacing/sm → spacing/md');
});

test('coerces object-shaped block_change/style_change to string instead of dropping the entry', t => {
	// Models intermittently emit structured JSON for free-form text
	// fields. The diff is still useful — the apply-diff agent reads
	// these as prose — so stringify rather than drop.
	const input = JSON.stringify({
		summary: '',
		matches_design: false,
		diffs: [
			{
				id: 'objecty-changes',
				region: 'Hero',
				severity: 'high',
				description: 'desc',
				block_change: {from: 'wp:paragraph', to: 'wp:heading', level: 2},
				style_change: {fontSize: 'preset:large', color: '#000'},
				affects_layout: true,
			},
		],
	});
	const r = parseDiffReport(input);
	t.is(r.diffs.length, 1);
	t.is(
		r.diffs[0]!.block_change,
		'{"from":"wp:paragraph","to":"wp:heading","level":2}',
	);
	t.is(r.diffs[0]!.style_change, '{"fontSize":"preset:large","color":"#000"}');
});

test('coerces object-shaped region/description to string', t => {
	const input = JSON.stringify({
		summary: '',
		matches_design: false,
		diffs: [
			{
				id: 'objecty-text',
				region: {name: 'Hero', selector: '.hero'},
				severity: 'low',
				description: ['line one', 'line two'],
				affects_layout: false,
			},
		],
	});
	const r = parseDiffReport(input);
	t.is(r.diffs.length, 1);
	t.is(r.diffs[0]!.region, '{"name":"Hero","selector":".hero"}');
	t.is(r.diffs[0]!.description, '["line one","line two"]');
});

test('matches_design true returns empty diffs even if some were sent', t => {
	const input = JSON.stringify({
		summary: 'all good',
		matches_design: true,
		diffs: [
			{
				id: 'x',
				region: 'y',
				severity: 'low',
				description: 'z',
				affects_layout: false,
			},
		],
	});
	const r = parseDiffReport(input);
	t.true(r.matches_design);
	t.is(r.diffs.length, 0);
});

test('skips entries missing required fields', t => {
	const input = JSON.stringify({
		summary: '',
		matches_design: false,
		diffs: [
			{
				id: 'ok',
				region: 'r',
				severity: 'high',
				description: 'd',
				affects_layout: true,
			},
			{
				id: 'no-region',
				severity: 'high',
				description: 'd',
				affects_layout: true,
			},
			{
				id: 'bad-severity',
				region: 'r',
				severity: 'extreme',
				description: 'd',
				affects_layout: true,
			},
			{id: 'no-affects', region: 'r', severity: 'low', description: 'd'},
			'not even an object',
			null,
		],
	});
	const r = parseDiffReport(input);
	t.is(r.diffs.length, 1);
	t.is(r.diffs[0]!.id, 'ok');
});

test('dedupes duplicate ids; first wins', t => {
	const input = JSON.stringify({
		summary: '',
		matches_design: false,
		diffs: [
			{
				id: 'dup',
				region: 'a',
				severity: 'high',
				description: 'first',
				affects_layout: false,
			},
			{
				id: 'dup',
				region: 'b',
				severity: 'low',
				description: 'second',
				affects_layout: true,
			},
		],
	});
	const r = parseDiffReport(input);
	t.is(r.diffs.length, 1);
	t.is(r.diffs[0]!.region, 'a');
});

test('throws on non-JSON', t => {
	t.throws(() => parseDiffReport('not json'), {
		message: /not valid JSON/i,
	});
});

test('throws on top-level non-object', t => {
	t.throws(() => parseDiffReport('[]'), {
		message: /not a JSON object/i,
	});
	t.throws(() => parseDiffReport('null'), {
		message: /not a JSON object/i,
	});
});

test('treats missing diffs array as empty', t => {
	const input = JSON.stringify({summary: 's', matches_design: false});
	const r = parseDiffReport(input);
	t.is(r.diffs.length, 0);
});

test('parseApplyEnvelope: accepts envelope with template + theme_json_patch', t => {
	const e = parseApplyEnvelope(
		JSON.stringify({
			template_html: '<!-- wp:group -->x<!-- /wp:group -->',
			theme_json_patch: {
				blocks: {
					'core/button': {color: {text: '#000'}, css: '.x{}'},
				},
			},
		}),
	);
	t.is(e.template_html, '<!-- wp:group -->x<!-- /wp:group -->');
	t.truthy(e.theme_json_patch);
	t.deepEqual(e.theme_json_patch?.blocks, {
		'core/button': {color: {text: '#000'}, css: '.x{}'},
	});
});

test('parseApplyEnvelope: rejects variations under theme_json_patch.blocks', t => {
	t.throws(
		() =>
			parseApplyEnvelope(
				JSON.stringify({
					template_html: '<!-- wp:p --><!-- /wp:p -->',
					theme_json_patch: {
						blocks: {
							'core/button': {variations: {'neptune-x': {}}},
						},
					},
				}),
			),
		{message: /variations is not supported.*block_style_variations/},
	);
});

test('parseApplyEnvelope: omitted theme_json_patch is undefined', t => {
	const e = parseApplyEnvelope(
		JSON.stringify({template_html: '<!-- wp:p --><!-- /wp:p -->'}),
	);
	t.is(e.theme_json_patch, undefined);
});

test('parseApplyEnvelope: rejects extra top-level keys in patch', t => {
	t.throws(
		() =>
			parseApplyEnvelope(
				JSON.stringify({
					template_html: '<!-- wp:p --><!-- /wp:p -->',
					theme_json_patch: {blocks: {}, settings: {color: {}}},
				}),
			),
		{message: /may only contain keys: blocks, custom/},
	);
});

test('parseApplyEnvelope: missing template_html surfaces as null (caller falls back to current markup)', t => {
	const e = parseApplyEnvelope(
		JSON.stringify({theme_json_patch: {blocks: {}}}),
	);
	t.is(e.template_html, null);
});

test('parseApplyEnvelope: empty/whitespace template_html surfaces as null', t => {
	const e1 = parseApplyEnvelope(JSON.stringify({template_html: ''}));
	t.is(e1.template_html, null);
	const e2 = parseApplyEnvelope(JSON.stringify({template_html: '   \n\t'}));
	t.is(e2.template_html, null);
});

test('parseApplyEnvelope: throws on non-JSON', t => {
	t.throws(() => parseApplyEnvelope('not json'), {
		message: /not valid JSON/i,
	});
});

test('parseApplyEnvelope: throws on top-level non-object', t => {
	t.throws(() => parseApplyEnvelope('[]'), {
		message: /not a JSON object/i,
	});
});

test('parseApplyEnvelope: applied + skipped arrays parse', t => {
	const e = parseApplyEnvelope(
		JSON.stringify({
			template_html: '<!-- wp:p --><!-- /wp:p -->',
			applied: [
				{id: 'a', summary: 'changed paragraph to heading'},
				{id: 'b', summary: 'set padding preset lg'},
			],
			skipped: [{id: 'c', reason: 'description was ambiguous'}],
		}),
	);
	t.is(e.applied.length, 2);
	t.is(e.applied[0]!.id, 'a');
	t.is(e.applied[0]!.summary, 'changed paragraph to heading');
	t.is(e.skipped.length, 1);
	t.is(e.skipped[0]!.reason, 'description was ambiguous');
});

test('parseApplyEnvelope: missing applied/skipped default to empty arrays', t => {
	const e = parseApplyEnvelope(
		JSON.stringify({template_html: '<!-- wp:p --><!-- /wp:p -->'}),
	);
	t.deepEqual(e.applied, []);
	t.deepEqual(e.skipped, []);
});

test('parseApplyEnvelope: drops malformed entries from applied/skipped', t => {
	const e = parseApplyEnvelope(
		JSON.stringify({
			template_html: '<!-- wp:p --><!-- /wp:p -->',
			applied: [
				{id: 'good', summary: 'ok'},
				{id: 'no-summary'},
				'string',
				null,
			],
			skipped: [{id: 'good2', reason: 'because'}, {summary: 'wrong field'}],
		}),
	);
	t.is(e.applied.length, 1);
	t.is(e.applied[0]!.id, 'good');
	t.is(e.skipped.length, 1);
	t.is(e.skipped[0]!.id, 'good2');
});

test('validateApplyCoverage: passes when every approved id is accounted for', t => {
	t.notThrows(() =>
		validateApplyCoverage(
			{
				template_html: 'x',
				applied: [{id: 'a', summary: 'x'}],
				skipped: [{id: 'b', reason: 'y'}],
			},
			['a', 'b'],
		),
	);
});

test('validateApplyCoverage: throws when any id is missing', t => {
	t.throws(
		() =>
			validateApplyCoverage(
				{
					template_html: 'x',
					applied: [{id: 'a', summary: 'x'}],
					skipped: [],
				},
				['a', 'b', 'c'],
			),
		{message: /b, c/},
	);
});

test('validateApplyCoverage: empty approved + empty applied/skipped passes', t => {
	t.notThrows(() =>
		validateApplyCoverage({template_html: 'x', applied: [], skipped: []}, []),
	);
});

test('validateApplyCoverage: extra ids in applied that are not approved are fine', t => {
	t.notThrows(() =>
		validateApplyCoverage(
			{
				template_html: 'x',
				applied: [
					{id: 'a', summary: 'x'},
					{id: 'extra', summary: 'unrequested'},
				],
				skipped: [],
			},
			['a'],
		),
	);
});
