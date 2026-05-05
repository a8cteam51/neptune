// PNG padding helper used to make two screenshots the same dimensions
// before pixel-diffing. The shorter (or narrower) image is padded with
// a single fill colour, top-left aligned, so the original content
// stays anchored to the top-left of the canvas. Magenta is the default
// fill: high contrast, unlikely to occur naturally, easy for both the
// human reviewer and the visual-diff agent to recognise as "no content
// here on this side."
import {Buffer} from 'node:buffer';
import {PNG} from 'pngjs';

export type PadColor = {r: number; g: number; b: number; a?: number};

export const PAD_MAGENTA: PadColor = {r: 255, g: 0, b: 255, a: 255};

export type PadResult = {
	designPng: Buffer;
	livePng: Buffer;
	canvas: {width: number; height: number};
	padded: boolean;
};

// Returns both buffers padded to a common canvas. If the inputs already
// share dimensions, returns them unchanged with `padded: false`.
export function padToMatch(
	designBuf: Buffer,
	liveBuf: Buffer,
	fill: PadColor = PAD_MAGENTA,
): PadResult {
	const design = PNG.sync.read(designBuf);
	const live = PNG.sync.read(liveBuf);

	if (design.width === live.width && design.height === live.height) {
		return {
			designPng: designBuf,
			livePng: liveBuf,
			canvas: {width: design.width, height: design.height},
			padded: false,
		};
	}

	const canvas = {
		width: Math.max(design.width, live.width),
		height: Math.max(design.height, live.height),
	};

	return {
		designPng: padTo(design, canvas, fill),
		livePng: padTo(live, canvas, fill),
		canvas,
		padded: true,
	};
}

export function padPng(
	buf: Buffer,
	target: {width: number; height: number},
	fill: PadColor = PAD_MAGENTA,
): Buffer {
	const src = PNG.sync.read(buf);
	if (src.width === target.width && src.height === target.height) return buf;
	if (target.width < src.width || target.height < src.height) {
		throw new Error(
			`padPng cannot shrink ${src.width}×${src.height} to ${target.width}×${target.height}`,
		);
	}
	return padTo(src, target, fill);
}

function padTo(
	src: PNG,
	target: {width: number; height: number},
	fill: PadColor,
): Buffer {
	const out = new PNG({width: target.width, height: target.height});
	const pixel = Buffer.from([fill.r, fill.g, fill.b, fill.a ?? 255]);
	for (let i = 0; i < out.data.length; i += 4) {
		out.data.set(pixel, i);
	}
	const srcStride = src.width * 4;
	const dstStride = target.width * 4;
	for (let y = 0; y < src.height; y++) {
		const srcRowStart = y * srcStride;
		const srcRow = src.data.subarray(srcRowStart, srcRowStart + srcStride);
		out.data.set(srcRow, y * dstStride);
	}
	return PNG.sync.write(out);
}
