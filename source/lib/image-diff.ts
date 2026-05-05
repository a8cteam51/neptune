// Pixel-level visual diff between two PNGs. Wraps `pixelmatch` over
// `pngjs`-decoded RGBA buffers and re-encodes the diff highlight as a
// PNG buffer so callers can write it to disk or hand it to a vision
// model.
//
// Returns null when the two PNGs don't share dimensions — pixelmatch
// requires equal sizes, and silently resizing here would mask a real
// problem (the rendered viewport doesn't match the design viewport).
// Callers should surface that mismatch to the user instead.
import {Buffer} from 'node:buffer';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';

export type DiffResult = {
	width: number;
	height: number;
	pixelsDiffered: number;
	totalPixels: number;
	ratio: number;
	pngBuffer: Buffer;
};

export type DiffOutcome =
	| {ok: true; diff: DiffResult}
	| {
			ok: false;
			reason: 'size_mismatch';
			a: {width: number; height: number};
			b: {width: number; height: number};
	  };

export function diffPngs(a: Buffer, b: Buffer): DiffOutcome {
	const aImg = PNG.sync.read(a);
	const bImg = PNG.sync.read(b);

	if (aImg.width !== bImg.width || aImg.height !== bImg.height) {
		return {
			ok: false,
			reason: 'size_mismatch',
			a: {width: aImg.width, height: aImg.height},
			b: {width: bImg.width, height: bImg.height},
		};
	}

	const {width, height} = aImg;
	const diff = new PNG({width, height});
	const pixelsDiffered = pixelmatch(
		aImg.data,
		bImg.data,
		diff.data,
		width,
		height,
		{threshold: 0.1, includeAA: false},
	);
	const totalPixels = width * height;

	return {
		ok: true,
		diff: {
			width,
			height,
			pixelsDiffered,
			totalPixels,
			ratio: pixelsDiffered / totalPixels,
			pngBuffer: PNG.sync.write(diff),
		},
	};
}
