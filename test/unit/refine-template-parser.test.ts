import test from 'ava';
import {
	parseApplyOutcomes,
	parseDiffReport,
	validateOutcomeCoverage,
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

test('parseApplyOutcomes: picks APPLIED + SKIPPED lines out of a mixed transcript', t => {
	const text = [
		'wrote wp_template:single (id 42, 1289 bytes)',
		'edited theme.json (extended styles.blocks.core/heading)',
		'APPLIED hero-heading-level: changed wp:paragraph to wp:heading level=1',
		'APPLIED footer-spacing: switched padding to var:preset|spacing|lg',
		'SKIPPED card-hover: description did not reference a specific block',
		'flushed theme.json cache',
	].join('\n');
	const {applied, skipped} = parseApplyOutcomes(text);
	t.is(applied.length, 2);
	t.is(applied[0]!.id, 'hero-heading-level');
	t.is(applied[0]!.summary, 'changed wp:paragraph to wp:heading level=1');
	t.is(applied[1]!.id, 'footer-spacing');
	t.is(skipped.length, 1);
	t.is(skipped[0]!.id, 'card-hover');
	t.is(skipped[0]!.reason, 'description did not reference a specific block');
});

test('parseApplyOutcomes: tolerates blank lines and leading whitespace', t => {
	const text = `

\t\tAPPLIED a: alpha
\tSKIPPED b: bravo

APPLIED c: charlie
`;
	const {applied, skipped} = parseApplyOutcomes(text);
	t.is(applied.length, 2);
	t.is(applied[0]!.id, 'a');
	t.is(applied[1]!.id, 'c');
	t.is(skipped.length, 1);
	t.is(skipped[0]!.id, 'b');
});

test('parseApplyOutcomes: ignores APPLIED/SKIPPED-shaped fragments inside other text', t => {
	const text =
		'Some narration: APPLIED inside a sentence is not a summary line.\nAPPLIED real-id: ok';
	const {applied} = parseApplyOutcomes(text);
	t.is(applied.length, 1);
	t.is(applied[0]!.id, 'real-id');
});

test('parseApplyOutcomes: empty input returns empty arrays', t => {
	const {applied, skipped} = parseApplyOutcomes('');
	t.deepEqual(applied, []);
	t.deepEqual(skipped, []);
});

test('validateOutcomeCoverage: passes when every approved id is accounted for', t => {
	t.notThrows(() =>
		validateOutcomeCoverage(
			[{id: 'a', summary: 'x'}],
			[{id: 'b', reason: 'y'}],
			['a', 'b'],
		),
	);
});

test('validateOutcomeCoverage: throws when any id is missing', t => {
	t.throws(
		() =>
			validateOutcomeCoverage([{id: 'a', summary: 'x'}], [], ['a', 'b', 'c']),
		{message: /b, c/},
	);
});

test('validateOutcomeCoverage: empty approved + empty applied/skipped passes', t => {
	t.notThrows(() => validateOutcomeCoverage([], [], []));
});

test('validateOutcomeCoverage: extra ids in applied that are not approved are fine', t => {
	t.notThrows(() =>
		validateOutcomeCoverage(
			[
				{id: 'a', summary: 'x'},
				{id: 'extra', summary: 'unrequested'},
			],
			[],
			['a'],
		),
	);
});
