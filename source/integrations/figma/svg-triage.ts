// Decides which downloaded SVGs are worth uploading to the WP media
// library. Figma's code generator emits SVGs for both real designer
// imagery (logos, brand marks, illustrations, icons used as content)
// and for pure decoration (1px dividers, ornaments, gradient overlays
// rendered as <rect>s). Uploading the latter clutters the media
// library and tempts build agents to emit wp:image where a separator
// or border would be correct.
//
// Strategy: one agent call for the whole batch. Each SVG goes in
// labeled by its constName; the agent returns a verdict per ref. The
// caller deletes discarded files from disk and only forwards the kept
// set to the upload step.
//
// The agent gets ONLY the SVG source bytes (per the rework spec) —
// no surrounding JSX, no rendered preview. That's a deliberate trade:
// "is this an icon or a divider" is usually obvious from the bytes
// alone, and the cheaper input keeps the call latency-bounded.
import {readFile, rm} from 'node:fs/promises';
import type {DownloadedAsset} from './assets-fetch.js';
import {runAgent, type TextBlock} from '../../lib/agent-stream.js';
import type {LogEvent} from '../../lib/event-list.js';

export type TriageVerdict = {
	constName: string;
	keep: boolean;
	reason: string;
};

export type SvgTriageResult = {
	kept: DownloadedAsset[];
	discarded: DownloadedAsset[];
	verdicts: TriageVerdict[];
};

export type TriageDeps = {
	runAgent?: typeof runAgent;
};

// Cap per-SVG bytes fed to the agent. Logos/icons compress to a few
// KB; anything bigger is almost always either a complex illustration
// (clearly "keep") or a page-sized decorative gradient (clearly
// "discard"), and either way the head of the file is enough signal.
// Keeping this bounded protects the prompt budget when a pull has 30+
// SVGs.
const SVG_BYTE_BUDGET = 8 * 1024;

export async function triageSvgs(
	candidates: DownloadedAsset[],
	cwd: string,
	pluginPath: string,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: TriageDeps = {},
): Promise<SvgTriageResult> {
	if (candidates.length === 0) {
		return {kept: [], discarded: [], verdicts: []};
	}

	onEvent({
		kind: 'step',
		message: `Triaging ${candidates.length} SVG${
			candidates.length === 1 ? '' : 's'
		} for value…`,
	});

	const sources = await Promise.all(
		candidates.map(async asset => ({
			asset,
			source: await readSvgForPrompt(asset.path),
		})),
	);

	const prompt = buildPrompt(sources);
	const agentRunner = deps.runAgent ?? runAgent;
	const responseText = await agentRunner(
		[{type: 'text', text: prompt} satisfies TextBlock],
		{cwd, pluginPath, signal, maxTurns: 2},
		onEvent,
	);

	const verdicts = parseVerdicts(responseText, candidates);
	const verdictByName = new Map(verdicts.map(v => [v.constName, v]));

	const kept: DownloadedAsset[] = [];
	const discarded: DownloadedAsset[] = [];
	for (const asset of candidates) {
		const verdict = verdictByName.get(asset.constName);
		// Missing verdicts default to "keep" rather than "discard": a
		// model that forgets a ref is less destructive if the file
		// survives. The build agent can still ignore unmapped SVG-style
		// content per the asset-mappings prompt.
		if (!verdict || verdict.keep) {
			kept.push(asset);
		} else {
			discarded.push(asset);
		}
	}

	for (const asset of discarded) {
		try {
			await rm(asset.path, {force: true});
		} catch (err) {
			onEvent({
				kind: 'warn',
				message: `Could not delete discarded SVG ${asset.filename}: ${
					err instanceof Error ? err.message : String(err)
				}`,
			});
		}
	}

	const keptCount = kept.length;
	const discardedCount = discarded.length;
	onEvent({
		kind: 'step',
		message: `SVG triage: ${keptCount} kept, ${discardedCount} discarded`,
	});

	return {kept, discarded, verdicts};
}

async function readSvgForPrompt(path: string): Promise<string> {
	const text = await readFile(path, 'utf8');
	if (text.length <= SVG_BYTE_BUDGET) return text;
	return `${text.slice(0, SVG_BYTE_BUDGET)}\n<!-- truncated: original ${text.length} bytes -->`;
}

function buildPrompt(
	entries: Array<{asset: DownloadedAsset; source: string}>,
): string {
	const lines: string[] = [
		'You are triaging SVG assets pulled from a Figma design. For each SVG, decide whether it is a "valuable" content asset (logos, brand marks, icons used as imagery, illustrations, photographs traced as SVG) or pure decoration (single-color dividers, 1–2px lines, gradient overlays, abstract shapes used as background, blurry blobs, isolated rectangles).',
		'',
		'Rules:',
		'- Keep: anything that carries brand identity (logos, monograms), recognizable imagery (people, products, scenes), or icons that a reader would interpret as content (a phone icon next to a phone number, a checkmark in a feature list).',
		'- Discard: dividers, separators, ornaments, decorative shapes, single-rectangle backgrounds, gradients, and anything whose only purpose is visual texture. The build agent has a structural-replacement path (border / wp:separator / background) for these — uploading them clutters the media library.',
		'- When unsure, KEEP. False positives clutter the library; false negatives lose real artwork. Bias toward keeping.',
		'',
		'Output a single JSON array (no surrounding prose, no markdown fences) with one object per input ref. Each object has exactly: { "constName": string, "keep": boolean, "reason": string (1 short sentence) }. Return verdicts in the same order as the input.',
		'',
		`There are ${entries.length} SVG${entries.length === 1 ? '' : 's'} to triage:`,
	];

	for (const {asset, source} of entries) {
		lines.push('');
		lines.push(
			`<svg-asset constName="${asset.constName}" filename="${asset.filename}">`,
		);
		lines.push(source.trim());
		lines.push('</svg-asset>');
	}

	return lines.join('\n');
}

// Parses the agent's JSON array response. Tolerates surrounding
// whitespace and a leading text preamble — we look for the first '['
// and parse from there. Verdicts that don't match a known constName
// are dropped silently; missing entries fall through to the "keep by
// default" branch in the caller.
export function parseVerdicts(
	responseText: string,
	candidates: DownloadedAsset[],
): TriageVerdict[] {
	const known = new Set(candidates.map(c => c.constName));
	const start = responseText.indexOf('[');
	const end = responseText.lastIndexOf(']');
	if (start === -1 || end === -1 || end <= start) {
		throw new Error(
			`SVG triage agent returned no JSON array: ${responseText.slice(0, 200)}`,
		);
	}
	const slice = responseText.slice(start, end + 1);
	let parsed: unknown;
	try {
		parsed = JSON.parse(slice);
	} catch (err) {
		throw new Error(
			`SVG triage agent returned invalid JSON: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
	if (!Array.isArray(parsed)) {
		throw new Error('SVG triage agent JSON was not an array.');
	}
	const out: TriageVerdict[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') continue;
		const e = entry as Record<string, unknown>;
		const constName = typeof e['constName'] === 'string' ? e['constName'] : '';
		const keep = typeof e['keep'] === 'boolean' ? e['keep'] : true;
		const reason = typeof e['reason'] === 'string' ? e['reason'] : '';
		if (!constName || !known.has(constName)) continue;
		out.push({constName, keep, reason});
	}
	return out;
}
