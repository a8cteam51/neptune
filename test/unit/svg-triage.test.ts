import test from 'ava';
import {access, writeFile} from 'node:fs/promises';
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
		},
	);
	t.is(called, 0);
	t.deepEqual(result, {kept: [], discarded: [], verdicts: []});
});

test('triageSvgs deletes discarded files and keeps survivors', async t => {
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
					{constName: 'imgDivider', keep: false, reason: '1px line'},
				]),
		},
	);

	t.deepEqual(
		result.kept.map(a => a.constName),
		['imgLogo'],
	);
	t.deepEqual(
		result.discarded.map(a => a.constName),
		['imgDivider'],
	);
	t.true(await fileExists(logo.path));
	t.false(await fileExists(divider.path));
});

test('triageSvgs defaults missing verdicts to keep', async t => {
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
		},
	);

	t.deepEqual(result.kept.map(a => a.constName).sort(), [
		'imgLogo',
		'imgOrphan',
	]);
	t.is(result.discarded.length, 0);
	t.true(await fileExists(orphan.path));
});

test('triageSvgs sends each SVG body to the agent labeled by constName', async t => {
	const dir = await makeTmpDir(t);
	const logo = await writeFixture(dir, 'logo.svg', SVG_LOGO, 'imgLogo');

	let captured = '';
	await triageSvgs(
		[logo],
		'/cwd',
		'/plugin',
		new AbortController().signal,
		() => {},
		{
			runAgent: async input => {
				captured =
					typeof input === 'string'
						? input
						: input.map(b => (b.type === 'text' ? b.text : '')).join('');
				return JSON.stringify([
					{constName: 'imgLogo', keep: true, reason: 'ok'},
				]);
			},
		},
	);

	t.regex(captured, /constName="imgLogo"/);
	t.regex(captured, /viewBox="0 0 64 64"/);
});
