// Decides which SVGs from a Figma pull are worth keeping, rasterizes
// the kept ones to PNG, and returns them as raster-typed assets ready
// for the standard media-import pipeline. The WP media library never
// sees an .svg — local sites without a working SVG-upload plugin
// (or with safe-svg mangling Figma's <use> graph) would otherwise
// drop these silently.
//
// Pipeline per pull:
//   1. Rasterize every candidate SVG to PNG (one Chromium for the batch).
//   2. Show the agent the rendered preview + constName label, ask
//      keep/discard for each. Vision is the strongest signal for
//      "logo vs divider" — far stronger than parsing path bytes.
//   3. Kept verdicts → PNG written to disk next to the original with
//      a .png basename, original .svg deleted, asset returned with
//      kind='raster' in `kept`.
//   4. Discarded verdicts → original .svg deleted; the constName plus
//      the agent's 1-sentence description of what the image was is
//      returned in `discarded` (cause='triage') so build/refine
//      agents downstream can pick a structural replacement (border /
//      wp:separator / background / drop) without re-deriving intent
//      from code.tsx alone.
//   5. Render failures (per-asset or whole-batch) → original .svg
//      deleted; the constName + the renderer's error message is
//      returned in `discarded` (cause='renderFail'). Loud warning so
//      the user can fix the renderer; build agents see the constName
//      had imagery but no media item.
import {rm} from 'node:fs/promises';
import {basename, dirname, extname, join} from 'node:path';
import {writeFileAtomic} from '../../lib/atomic-write.js';
import type {DownloadedAsset} from './assets-fetch.js';
import {
	runAgent,
	type ContentBlock,
	type ImageBlock,
	type TextBlock,
} from '../../lib/agent-stream.js';
import type {LogEvent} from '../../lib/event-list.js';
import {rasterizeSvgs} from '../../lib/svg-rasterize.js';
import type {DiscardedAsset} from '../../lib/types.js';

export type TriageVerdict = {
	constName: string;
	keep: boolean;
	reason: string;
};

export type SvgTriageResult = {
	// Each kept asset has been rewritten to PNG on disk. filename ends
	// in .png, kind === 'raster', path points to the new file.
	kept: DownloadedAsset[];
	// Source SVGs that were either render-failed or rejected by the
	// agent. Files have already been removed from disk. Each entry
	// carries the constName + a short description of what the image
	// was so the caller can persist them in meta.json — build/refine
	// agents downstream rely on this to pick a structural replacement
	// for the missing image.
	discarded: DiscardedAsset[];
	verdicts: TriageVerdict[];
};

export type TriageDeps = {
	runAgent?: typeof runAgent;
	rasterize?: typeof rasterizeSvgs;
};

// Render quality for the PNG that will end up in the media library.
// Logos and icons render small in the page, but a hero illustration
// can be displayed wide — 1024 on the long edge stays sharp at
// realistic display sizes without ballooning attachment storage.
// Aspect ratio is preserved by the rasterizer's CSS.
const RASTER_MAX_EDGE = 1024;

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

	const rasterizer = deps.rasterize ?? rasterizeSvgs;
	const renderErrors = new Map<string, string>();
	let renders: Array<Buffer | undefined>;
	try {
		renders = await rasterizer(
			candidates.map(a => a.path),
			{
				signal,
				maxWidth: RASTER_MAX_EDGE,
				maxHeight: RASTER_MAX_EDGE,
				onWarn: (failedPath, err) => {
					renderErrors.set(
						failedPath,
						err instanceof Error ? err.message : String(err),
					);
				},
			},
		);
	} catch (err) {
		// Whole-batch failure (browser launch, etc.) — every SVG is now
		// un-uploadable. Drop the lot loudly so the user knows imagery
		// is missing from this pull.
		const message = err instanceof Error ? err.message : String(err);
		onEvent({
			kind: 'warn',
			message: `SVG rasterization failed; dropping all ${candidates.length} SVG${
				candidates.length === 1 ? '' : 's'
			} from this pull: ${message}`,
		});
		await deleteAll(candidates, onEvent);
		return {
			kept: [],
			discarded: candidates.map(asset =>
				renderFailDiscard(asset, `Rasterization batch failed: ${message}`),
			),
			verdicts: [],
		};
	}

	const renderable: Array<{asset: DownloadedAsset; png: Buffer}> = [];
	const renderFailed: DiscardedAsset[] = [];
	for (let i = 0; i < candidates.length; i++) {
		const png = renders[i];
		const asset = candidates[i]!;
		if (png) {
			renderable.push({asset, png});
		} else {
			const detail = renderErrors.get(asset.path);
			renderFailed.push(
				renderFailDiscard(
					asset,
					detail ? `Could not rasterize: ${detail}` : 'Could not rasterize.',
				),
			);
			onEvent({
				kind: 'warn',
				message: detail
					? `Could not rasterize ${asset.filename}; dropping (no PNG to upload). ${detail}`
					: `Could not rasterize ${asset.filename}; dropping (no PNG to upload).`,
			});
			// Remove the .svg from disk so the pull dir doesn't keep
			// stale assets the build agent might stumble on. Cleanup
			// pairs with the discard record above.
			await safeRm(asset.path, onEvent, asset.filename);
		}
	}

	let verdicts: TriageVerdict[] = [];
	if (renderable.length > 0) {
		const blocks = buildAgentBlocks(renderable);
		const agentRunner = deps.runAgent ?? runAgent;
		const responseText = await agentRunner(
			blocks,
			{cwd, pluginPath, signal, maxTurns: 2},
			onEvent,
		);
		verdicts = parseVerdicts(
			responseText,
			renderable.map(r => r.asset),
		);
	}
	const verdictByName = new Map(verdicts.map(v => [v.constName, v]));

	const kept: DownloadedAsset[] = [];
	const agentDiscarded: DiscardedAsset[] = [];

	for (const {asset, png} of renderable) {
		const verdict = verdictByName.get(asset.constName);
		// Missing verdicts default to "keep" rather than "discard": a
		// model that forgets a ref is less destructive if the file
		// survives. Bytes-fallback bias toward keep is preserved.
		if (!verdict || verdict.keep) {
			try {
				const pngAsset = await materializeAsPng(asset, png);
				kept.push(pngAsset);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				onEvent({
					kind: 'warn',
					message: `Could not write PNG for ${asset.filename}; dropping: ${message}`,
				});
				// Materialize-fail is a pipeline failure (the agent said
				// keep), not a triage decision — record under renderFail
				// so downstream context reflects "we lost the bytes",
				// not "we judged this decoration".
				agentDiscarded.push(
					renderFailDiscard(asset, `Could not write PNG: ${message}`),
				);
				await safeRm(asset.path, onEvent, asset.filename);
			}
		} else {
			agentDiscarded.push({
				constName: asset.constName,
				filename: asset.filename,
				// Fallback when the agent rejected the SVG but forgot the
				// reason field. Filename is the only non-redundant fact
				// we can carry forward (constName is already in the
				// record's header), so include it — Figma sometimes
				// encodes a hint in the filename ("divider-line.svg")
				// even when the hash form is opaque.
				description:
					verdict.reason ||
					`Discarded by triage as decoration; agent omitted a description (source SVG was ${asset.filename}). Fall back to JSX context (parent classes, dimensions, position) when picking a structural replacement.`,
				cause: 'triage',
			});
			await safeRm(asset.path, onEvent, asset.filename);
		}
	}

	onEvent({
		kind: 'step',
		message: `SVG triage: ${kept.length} kept (as PNG), ${
			agentDiscarded.length + renderFailed.length
		} discarded`,
	});

	return {
		kept,
		discarded: [...agentDiscarded, ...renderFailed],
		verdicts,
	};
}

function renderFailDiscard(
	asset: DownloadedAsset,
	description: string,
): DiscardedAsset {
	return {
		constName: asset.constName,
		filename: asset.filename,
		description,
		cause: 'renderFail',
	};
}

// Writes the rendered PNG to <basename>.png next to the original SVG,
// removes the original, and returns a DownloadedAsset describing the
// new file. The constName is preserved so build-agent mappings keep
// pointing to the right ref.
async function materializeAsPng(
	asset: DownloadedAsset,
	png: Buffer,
): Promise<DownloadedAsset> {
	const dir = dirname(asset.path);
	const stem = basename(asset.filename, extname(asset.filename));
	const pngFilename = `${stem}.png`;
	const pngPath = join(dir, pngFilename);
	await writeFileAtomic(pngPath, png);
	if (pngPath !== asset.path) {
		try {
			await rm(asset.path, {force: true});
		} catch {
			// Best effort; the PNG is what gets uploaded either way.
		}
	}
	return {
		...asset,
		filename: pngFilename,
		path: pngPath,
		kind: 'raster',
	};
}

async function safeRm(
	path: string,
	onEvent: (ev: LogEvent) => void,
	label: string,
): Promise<void> {
	try {
		await rm(path, {force: true});
	} catch (err) {
		onEvent({
			kind: 'warn',
			message: `Could not delete ${label}: ${
				err instanceof Error ? err.message : String(err)
			}`,
		});
	}
}

async function deleteAll(
	assets: DownloadedAsset[],
	onEvent: (ev: LogEvent) => void,
): Promise<void> {
	for (const asset of assets) {
		await safeRm(asset.path, onEvent, asset.filename);
	}
}

function buildAgentBlocks(
	entries: Array<{asset: DownloadedAsset; png: Buffer}>,
): ContentBlock[] {
	const blocks: ContentBlock[] = [
		{
			type: 'text',
			text: buildPromptHeader(entries.length),
		} satisfies TextBlock,
	];
	for (const {asset, png} of entries) {
		blocks.push({
			type: 'text',
			text: `<svg-asset constName="${asset.constName}" filename="${asset.filename}">`,
		} satisfies TextBlock);
		blocks.push({
			type: 'image',
			source: {
				type: 'base64',
				media_type: 'image/png',
				data: png.toString('base64'),
			},
		} satisfies ImageBlock);
		blocks.push({type: 'text', text: '</svg-asset>'} satisfies TextBlock);
	}
	return blocks;
}

function buildPromptHeader(count: number): string {
	return [
		'You are triaging SVG assets pulled from a Figma design. For each SVG, decide whether it is a "valuable" content asset (logos, brand marks, icons used as imagery, illustrations, photographs traced as SVG) or pure decoration (single-color dividers, 1–2px lines, gradient overlays, abstract shapes used as background, blurry blobs, isolated rectangles).',
		'',
		'How the SVGs are presented:',
		'- Each SVG appears between <svg-asset constName="…" filename="…"> and </svg-asset> tags. The constName attribute is your join key for the response.',
		'- A rendered preview of the SVG follows the opening tag as an image. Decide based on what the image actually depicts.',
		'',
		'Rules:',
		'- Keep: anything that carries brand identity (logos, monograms), recognizable imagery (people, products, scenes), or icons that a reader would interpret as content (a phone icon next to a phone number, a checkmark in a feature list).',
		'- Discard: dividers, separators, ornaments, decorative shapes, single-rectangle backgrounds, gradients, and anything whose only purpose is visual texture. The build agent has a structural-replacement path (border / wp:separator / background) for these — uploading them clutters the media library.',
		'- When unsure, KEEP. False positives clutter the library; false negatives lose real artwork. Bias toward keeping.',
		'',
		'Output a single JSON array (no surrounding prose, no markdown fences) with one object per input ref. Each object has exactly: { "constName": string, "keep": boolean, "reason": string }. Return verdicts in the same order as the input.',
		'',
		'Reason field: one short sentence describing what the rendered image depicts. The downstream build agent reads this — for kept items it is informational, for discarded items it is the ONLY surviving record of what the image was, and the agent uses it to pick a structural replacement (border / wp:separator / background / drop). So:',
		'- For DISCARDS, lead with the structural category, then any visual specifics. Examples: "Horizontal 1px divider line, full-width." / "Decorative gradient blob behind hero section." / "Single rounded-rectangle background shape." / "Vertical full-height separator on left edge." Avoid bare verdicts like "decorative shape" — say what the shape IS.',
		'- For KEEPS, describe the subject. Examples: "Company wordmark in black." / "Photograph-style illustration of a person at a desk." / "Checkmark glyph used in a feature list."',
		'',
		`There are ${count} SVG${count === 1 ? '' : 's'} to triage:`,
	].join('\n');
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
