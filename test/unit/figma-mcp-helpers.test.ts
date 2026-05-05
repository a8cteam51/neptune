import test from 'ava';
import {
	FigmaRateLimitError,
	parseSelectionMetadata,
} from '../../source/integrations/figma/mcp.js';

test('parseSelectionMetadata: extracts name + rounded coords from first non-empty line', t => {
	const xml =
		'<frame id="1:1" name="Hero" x="42.6" y="100.4" width="1440" height="900"/>';
	const m = parseSelectionMetadata(xml);
	t.is(m.name, 'Hero');
	t.is(m.x, 43);
	t.is(m.y, 100);
	t.is(m.rawXml, xml);
});

test('parseSelectionMetadata: ignores leading blank lines', t => {
	const xml = '\n\n  \n<frame name="X" x="0" y="0"/>';
	const m = parseSelectionMetadata(xml);
	t.is(m.name, 'X');
});

test('parseSelectionMetadata: missing attrs leave fields undefined', t => {
	const m = parseSelectionMetadata('<frame/>');
	t.is(m.name, undefined);
	t.is(m.x, undefined);
	t.is(m.y, undefined);
});

test('parseSelectionMetadata: non-numeric x/y becomes undefined', t => {
	const m = parseSelectionMetadata('<frame name="A" x="abc" y="zzz"/>');
	t.is(m.name, 'A');
	t.is(m.x, undefined);
	t.is(m.y, undefined);
});

function makeHeaders(entries: [string, string][]): Headers {
	const h = new Headers();
	for (const [k, v] of entries) h.append(k, v);
	return h;
}

test('FigmaRateLimitError: parses retry-after, type, plan, upgrade headers', t => {
	const headers = makeHeaders([
		['retry-after', '30'],
		['x-figma-rate-limit-type', 'desktop-mcp'],
		['x-figma-plan-tier', 'pro'],
		['x-figma-upgrade-link', 'https://example/upgrade'],
	]);
	const err = new FigmaRateLimitError(429, headers, 'too many');
	t.is(err.status, 429);
	t.is(err.retryAfterSec, 30);
	t.is(err.rateLimitType, 'desktop-mcp');
	t.is(err.planTier, 'pro');
	t.is(err.upgradeLink, 'https://example/upgrade');
	t.regex(err.message, /HTTP 429/);
	t.regex(err.message, /retry after 30s/);
	t.regex(err.message, /desktop-mcp/);
});

test('FigmaRateLimitError: missing retry-after stays undefined', t => {
	const err = new FigmaRateLimitError(429, makeHeaders([]), '');
	t.is(err.retryAfterSec, undefined);
	t.is(err.rateLimitType, undefined);
});

test('FigmaRateLimitError: non-numeric retry-after stays undefined', t => {
	const err = new FigmaRateLimitError(
		429,
		makeHeaders([['retry-after', 'soon']]),
		'',
	);
	t.is(err.retryAfterSec, undefined);
});

test('FigmaRateLimitError: long body is truncated in message but full body preserved', t => {
	const longBody = 'x'.repeat(500);
	const err = new FigmaRateLimitError(429, makeHeaders([]), longBody);
	t.is(err.body, longBody);
	t.regex(err.message, /…/);
});
