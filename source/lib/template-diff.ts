// Capture-and-diff pipeline shared by `refine-template` (which feeds
// the diff into the visual-diff agent) and `view-template-diff` (a
// human-only viewer with no agent invocation). Reads design.png,
// captures the live page at the same dimensions, pads if necessary,
// runs odiff, and writes live.png + diff.png next to design.png.
import {Buffer} from 'node:buffer';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFileAtomic} from './atomic-write.js';
import {captureAtSize, selectorForRole} from './browser-capture.js';
import {diffImages, type DiffOutcome} from './odiff-runner.js';
import {padToMatch} from './png-pad.js';
import {templateRole} from './template-scaffold.js';
import {getSiteUrl} from '../integrations/studio/site.js';
import {readPngSize} from '../commands/verify-screenshots.js';
import type {LogEvent} from './event-list.js';
import type {Loaded} from '../commands/setup-project/types.js';
import type {PullMeta} from './types.js';

// A pull that's eligible for capture/diff: must have a templateFile so
// we can pick a screenshot selector and target the right WP template.
export type DiffPull = PullMeta & {templateFile: string};

// Below this pixel-diff ratio we treat the live render as matching the
// design, even when odiff reports a non-zero number. Anti-aliasing,
// font hinting, and subpixel rendering all show up as small ratios
// that don't visually matter — paying for a refine agent run on them
// would be waste. 0.5% is the empirical threshold; refine-template /
// refine-content honor it before invoking the visual-diff agent.
export const PIXEL_DIFF_THRESHOLD = 0.5;

export type CaptureAndDiffDeps = {
	captureAtSize?: typeof captureAtSize;
};

export type CaptureAndDiffResult = {
	designPath: string;
	livePath: string;
	diffPath: string;
	designBuf: Buffer;
	liveBuf: Buffer;
	designSize: {width: number; height: number};
	liveSize: {width: number; height: number} | null;
	// Set when live render dimensions disagree with design — useful both
	// as a user warning and as input to "treat-as-match" thresholding.
	sizeNote: string | null;
	outcome: DiffOutcome;
};

export class CaptureAbortedError extends Error {
	constructor() {
		super('Capture aborted');
		this.name = 'CaptureAbortedError';
	}
}

export async function captureAndDiffPull(
	loaded: Loaded,
	pull: DiffPull,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: CaptureAndDiffDeps = {},
): Promise<CaptureAndDiffResult> {
	const capture = deps.captureAtSize ?? captureAtSize;

	const designPath = join(loaded.dir, 'design', pull.slug, 'screenshot.png');
	const designBuf = await readFile(designPath).catch(() => null);
	if (!designBuf) {
		throw new Error(`No design screenshot at ${designPath}.`);
	}
	const designSize = readPngSize(designBuf);
	if (!designSize) {
		throw new Error(`design/${pull.slug}/screenshot.png is not a valid PNG.`);
	}
	onEvent({
		kind: 'step',
		message: `Design screenshot ${designSize.width}×${designSize.height}`,
	});

	const siteUrl = await getSiteUrl(loaded.dir);
	if (!siteUrl) {
		throw new Error(
			'Could not resolve the running site URL from ~/.studio/cli.json. Is the site registered with Studio?',
		);
	}
	const previewPath = pull.previewPath ?? '/';
	const previewUrl = siteUrl + previewPath;
	const role = templateRole(pull.templateFile);
	const selector = selectorForRole(role);
	onEvent({
		kind: 'step',
		message: selector
			? `Capturing ${previewUrl} (element ${selector})`
			: `Capturing ${previewUrl}`,
	});

	const liveBuf = await capture({
		url: previewUrl,
		width: designSize.width,
		height: designSize.height,
		signal,
		selector,
	});

	if (signal.aborted) throw new CaptureAbortedError();

	const livePath = join(loaded.dir, 'design', pull.slug, 'live.png');
	await writeFileAtomic(livePath, liveBuf);

	const liveSize = readPngSize(liveBuf);
	const sizeNote =
		liveSize &&
		(liveSize.width !== designSize.width ||
			liveSize.height !== designSize.height)
			? `Live ${liveSize.width}×${liveSize.height} differs from design ${designSize.width}×${designSize.height}.`
			: null;
	if (sizeNote) {
		onEvent({kind: 'warn', message: sizeNote});
	}
	onEvent({kind: 'step', message: `Saved live.png (${liveBuf.length} bytes)`});

	const diffPath = join(loaded.dir, 'design', pull.slug, 'diff.png');
	const outcome = await diffWithPadding(
		designBuf,
		liveBuf,
		designPath,
		livePath,
		diffPath,
		onEvent,
	);

	return {
		designPath,
		livePath,
		diffPath,
		designBuf,
		liveBuf,
		designSize,
		liveSize,
		sizeNote,
		outcome,
	};
}

// odiff requires identical dimensions, but the design and live render
// often disagree on height (the whole point of refinement). We pad
// both buffers to a common canvas with magenta in the missing region,
// run odiff against the padded copies in a temp dir, and write the
// resulting diff.png to the pull's design folder. The padded copies
// are discarded — the user keeps the original design.png/live.png.
async function diffWithPadding(
	designBuf: Buffer,
	liveBuf: Buffer,
	designPath: string,
	livePath: string,
	diffPath: string,
	onEvent: (ev: LogEvent) => void,
): Promise<DiffOutcome> {
	const padded = padToMatch(designBuf, liveBuf);

	if (!padded.padded) {
		return diffImages(designPath, livePath, diffPath, {
			threshold: 0.1,
			antialiasing: true,
		});
	}

	onEvent({
		kind: 'step',
		message: `Padding to ${padded.canvas.width}×${padded.canvas.height} for diff`,
	});

	const tmpDir = await mkdtemp(join(tmpdir(), 'neptune-pad-'));
	try {
		const paddedDesignPath = join(tmpDir, 'design.png');
		const paddedLivePath = join(tmpDir, 'live.png');
		await writeFileAtomic(paddedDesignPath, padded.designPng);
		await writeFileAtomic(paddedLivePath, padded.livePng);
		return await diffImages(paddedDesignPath, paddedLivePath, diffPath, {
			threshold: 0.1,
			antialiasing: true,
		});
	} finally {
		await rm(tmpDir, {recursive: true, force: true}).catch(() => {});
	}
}
