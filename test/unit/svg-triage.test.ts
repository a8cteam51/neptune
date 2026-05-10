import test from 'ava';
import {access, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {makeTmpDir} from '../helpers/tmp.js';
import type {DownloadedAsset} from '../../source/integrations/figma/assets-fetch.js';
import {
	parseVerdicts,
	triageSvgs,
} from '../../source/integrations/figma/svg-triage.js';

const SVG_LOGO =
	'<svg viewBox="0 0 64 64"><path d="M2 2 L62 62" stroke="black" stroke-width="6"/></svg>';
const SVG_DIVIDER =
	'<svg width="240" height="2"><rect width="240" height="2" fill="#ccc"/></svg>';

// A 1×1 transparent PNG, used as the rasterizer's "successful render"
// stub. Its bytes are arbitrary — the test only cares that the kept
// asset on disk equals what the rasterizer returned.
const PNG_1x1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
	'base64',
);

const stubRasterize = async (paths: string[]) => paths.map(() => PNG_1x1);
const failRasterize = async (paths: string[]) => paths.map(() => undefined);

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function writeFixture(
	dir: string,
	filename: string,
	body: string,
	constName: string,
	url = `http://localhost:3845/assets/${filename}`,
): Promise<DownloadedAsset> {
	const path = join(dir, filename);
	await writeFile(path, body, 'utf8');
	return {constName, filename, url, path, kind: 'svg'};
}

test('parseVerdicts extracts a clean JSON array', t => {
	const candidates: DownloadedAsset[] = [
		{
			constName: 'imgLogo',
			filename: 'a.svg',
			url: 'http://localhost:3845/assets/a.svg',
			path: '/tmp/a.svg',
			kind: 'svg',
		},
		{
			constName: 'imgDivider',
			filename: 'b.svg',
			url: 'http://localhost:3845/assets/b.svg',
			path: '/tmp/b.svg',
			kind: 'svg',
		},
	];
	const response = `[
		{"constName": "imgLogo", "keep": true, "reason": "brand logo"},
		{"constName": "imgDivider", "keep": false, "reason": "1px divider"}
	]`;
	t.deepEqual(parseVerdicts(response, candidates), [
		{constName: 'imgLogo', keep: true, reason: 'brand logo'},
		{constName: 'imgDivider', keep: false, reason: '1px divider'},
	]);
});

test('parseVerdicts tolerates surrounding prose', t => {
	const candidates: DownloadedAsset[] = [
		{
			constName: 'imgLogo',
			filename: 'a.svg',
			url: 'http://localhost:3845/assets/a.svg',
			path: '/tmp/a.svg',
			kind: 'svg',
		},
	];
	const response = `Here are the verdicts:\n[{"constName":"imgLogo","keep":true,"reason":"logo"}]\nDone.`;
	t.deepEqual(parseVerdicts(response, candidates), [
		{constName: 'imgLogo', keep: true, reason: 'logo'},
	]);
});

test('parseVerdicts drops verdicts referencing unknown constNames', t => {
	const candidates: DownloadedAsset[] = [
		{
			constName: 'imgLogo',
			filename: 'a.svg',
			url: 'http://localhost:3845/assets/a.svg',
			path: '/tmp/a.svg',
			kind: 'svg',
		},
	];
	const response = `[{"constName":"imgLogo","keep":true,"reason":"x"},{"constName":"imgGhost","keep":false,"reason":"x"}]`;
	t.deepEqual(parseVerdicts(response, candidates), [
		{constName: 'imgLogo', keep: true, reason: 'x'},
	]);
});

test('parseVerdicts throws on missing JSON array', t => {
	t.throws(() => parseVerdicts('no array here', []), {
		message: /returned no JSON array/,
	});
});

test('parseVerdicts throws on malformed JSON', t => {
	t.throws(() => parseVerdicts('[{not json}]', []), {
		message: /invalid JSON/,
	});
});

test('triageSvgs is a no-op on empty input and does not call the agent', async t => {
	let called = 0;
	const result = await triageSvgs(
		[],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		() => {},
		{
			runAgent: async () => {
				called++;
				return '[]';
			},
			rasterize: stubRasterize,
		},
	);
	t.is(called, 0);
	t.deepEqual(result, {kept: [], discarded: [], verdicts: []});
});

test('triageSvgs writes kept SVGs as PNG, removes the original SVG', async t => {
	const dir = await makeTmpDir(t);
	const logo = await writeFixture(dir, 'logo.svg', SVG_LOGO, 'imgLogo');
	const divider = await writeFixture(
		dir,
		'divider.svg',
		SVG_DIVIDER,
		'imgDivider',
	);

	const result = await triageSvgs(
		[logo, divider],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		() => {},
		{
			runAgent: async () =>
				JSON.stringify([
					{constName: 'imgLogo', keep: true, reason: 'logo'},
					{
						constName: 'imgDivider',
						keep: false,
						reason: 'Horizontal 1px divider line, full-width.',
					},
				]),
			rasterize: stubRasterize,
		},
	);

	t.is(result.kept.length, 1);
	const kept = result.kept[0]!;
	t.is(kept.constName, 'imgLogo');
	t.is(kept.kind, 'raster');
	t.is(kept.filename, 'logo.png');
	t.true(kept.path.endsWith('/logo.png'));
	t.true(await fileExists(kept.path));
	t.deepEqual(await readFile(kept.path), PNG_1x1);

	// Original SVGs are gone (kept one rewritten, discarded one removed).
	t.false(await fileExists(logo.path));
	t.false(await fileExists(divider.path));

	// Triage-discard records carry the agent's description so build/refine
	// agents can pick a structural replacement without re-deriving intent.
	t.is(result.discarded.length, 1);
	t.deepEqual(result.discarded[0], {
		constName: 'imgDivider',
		filename: 'divider.svg',
		description: 'Horizontal 1px divider line, full-width.',
		cause: 'triage',
	});
});

test('triageSvgs falls back to a default description when the agent omits one', async t => {
	const dir = await makeTmpDir(t);
	const logo = await writeFixture(dir, 'logo.svg', SVG_LOGO, 'imgLogo');

	const result = await triageSvgs(
		[logo],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		() => {},
		{
			runAgent: async () =>
				JSON.stringify([{constName: 'imgLogo', keep: false, reason: ''}]),
			rasterize: stubRasterize,
		},
	);

	t.is(result.kept.length, 0);
	t.is(result.discarded.length, 1);
	t.is(result.discarded[0]!.cause, 'triage');
	t.true(result.discarded[0]!.description.length > 0);
});

test('triageSvgs defaults missing verdicts to keep (and rasterizes them)', async t => {
	const dir = await makeTmpDir(t);
	const logo = await writeFixture(dir, 'logo.svg', SVG_LOGO, 'imgLogo');
	const orphan = await writeFixture(dir, 'orphan.svg', SVG_LOGO, 'imgOrphan');

	const result = await triageSvgs(
		[logo, orphan],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		() => {},
		{
			runAgent: async () =>
				JSON.stringify([{constName: 'imgLogo', keep: true, reason: 'logo'}]),
			rasterize: stubRasterize,
		},
	);

	t.deepEqual(result.kept.map(a => a.constName).sort(), [
		'imgLogo',
		'imgOrphan',
	]);
	for (const asset of result.kept) {
		t.is(asset.kind, 'raster');
		t.regex(asset.filename, /\.png$/);
		t.true(await fileExists(asset.path));
	}
	t.is(result.discarded.length, 0);
});

test('triageSvgs sends a rendered PNG image block per SVG', async t => {
	const dir = await makeTmpDir(t);
	const logo = await writeFixture(dir, 'logo.svg', SVG_LOGO, 'imgLogo');

	let textCaptured = '';
	let imageBlocks = 0;
	await triageSvgs(
		[logo],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		() => {},
		{
			runAgent: async input => {
				if (typeof input === 'string') {
					textCaptured = input;
				} else {
					textCaptured = input
						.map(b => (b.type === 'text' ? b.text : ''))
						.join('\n');
					imageBlocks = input.filter(b => b.type === 'image').length;
				}
				return JSON.stringify([
					{constName: 'imgLogo', keep: true, reason: 'ok'},
				]);
			},
			rasterize: stubRasterize,
		},
	);

	t.regex(textCaptured, /constName="imgLogo"/);
	t.is(imageBlocks, 1);
	// Source bytes must NOT leak into the prompt — the agent only sees the render now.
	t.notRegex(textCaptured, /viewBox="0 0 64 64"/);
});

test('triageSvgs discards SVGs whose render failed and warns', async t => {
	const dir = await makeTmpDir(t);
	const logo = await writeFixture(dir, 'logo.svg', SVG_LOGO, 'imgLogo');

	let agentCalled = 0;
	const warnings: string[] = [];
	const result = await triageSvgs(
		[logo],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		ev => {
			if (ev.kind === 'warn') warnings.push(ev.message);
		},
		{
			runAgent: async () => {
				agentCalled++;
				return '[]';
			},
			rasterize: failRasterize,
		},
	);

	t.is(agentCalled, 0); // No renderable SVGs → no agent call
	t.is(result.kept.length, 0);
	t.is(result.discarded.length, 1);
	const failed = result.discarded[0]!;
	t.is(failed.constName, 'imgLogo');
	t.is(failed.cause, 'renderFail');
	t.regex(failed.description, /rasterize/i);
	t.true(warnings.some(m => /Could not rasterize/i.test(m)));
	// Original SVG is deleted to avoid leaving stale unused files.
	t.false(await fileExists(logo.path));
});

test('triageSvgs drops every SVG when the whole-batch rasterizer throws', async t => {
	const dir = await makeTmpDir(t);
	const logo = await writeFixture(dir, 'logo.svg', SVG_LOGO, 'imgLogo');
	const divider = await writeFixture(
		dir,
		'divider.svg',
		SVG_DIVIDER,
		'imgDivider',
	);

	let agentCalled = 0;
	const warnings: string[] = [];
	const result = await triageSvgs(
		[logo, divider],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		ev => {
			if (ev.kind === 'warn') warnings.push(ev.message);
		},
		{
			runAgent: async () => {
				agentCalled++;
				return '[]';
			},
			rasterize: async () => {
				throw new Error('chromium unavailable');
			},
		},
	);

	t.is(agentCalled, 0);
	t.is(result.kept.length, 0);
	t.is(result.discarded.length, 2);
	t.true(warnings.some(m => /rasterization failed/i.test(m)));
	for (const d of result.discarded) {
		t.is(d.cause, 'renderFail');
		t.regex(d.description, /Rasterization batch failed/);
	}
	t.false(await fileExists(logo.path));
	t.false(await fileExists(divider.path));
});

test('triageSvgs mixes per-asset render success and failure', async t => {
	const dir = await makeTmpDir(t);
	const logo = await writeFixture(dir, 'logo.svg', SVG_LOGO, 'imgLogo');
	const broken = await writeFixture(
		dir,
		'broken.svg',
		'<not even svg>',
		'imgBroken',
	);

	const result = await triageSvgs(
		[logo, broken],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		() => {},
		{
			runAgent: async () =>
				JSON.stringify([{constName: 'imgLogo', keep: true, reason: 'logo'}]),
			rasterize: async paths =>
				paths.map(p => (p.endsWith('logo.svg') ? PNG_1x1 : undefined)),
		},
	);

	t.deepEqual(
		result.kept.map(a => a.constName),
		['imgLogo'],
	);
	t.is(result.kept[0]!.kind, 'raster');
	t.deepEqual(
		result.discarded.map(a => a.constName),
		['imgBroken'],
	);
	t.false(await fileExists(logo.path));
	t.false(await fileExists(broken.path));
});
