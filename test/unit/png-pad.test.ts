import test from 'ava';
import {PNG} from 'pngjs';
import {Buffer} from 'node:buffer';
import {
	PAD_MAGENTA,
	padPng,
	padToMatch,
} from '../../source/lib/png-pad.js';

function makePng(
	width: number,
	height: number,
	color: {r: number; g: number; b: number; a?: number} = {
		r: 255,
		g: 255,
		b: 255,
	},
): Buffer {
	const png = new PNG({width, height});
	const pixel = Buffer.from([color.r, color.g, color.b, color.a ?? 255]);
	for (let i = 0; i < png.data.length; i += 4) {
		png.data.set(pixel, i);
	}
	return PNG.sync.write(png);
}

function readPng(buf: Buffer) {
	return PNG.sync.read(buf);
}

test('padPng: returns input unchanged when already at target size', t => {
	const buf = makePng(40, 30);
	const out = padPng(buf, {width: 40, height: 30});
	t.is(out, buf);
});

test('padPng: pads vertically with magenta and preserves top region', t => {
	const buf = makePng(40, 20, {r: 0, g: 200, b: 0});
	const out = padPng(buf, {width: 40, height: 30});
	const png = readPng(out);
	t.is(png.width, 40);
	t.is(png.height, 30);
	// Top-left pixel is the original green
	t.is(png.data[0], 0);
	t.is(png.data[1], 200);
	t.is(png.data[2], 0);
	t.is(png.data[3], 255);
	// A pixel in the padded bottom region is magenta
	const padIdx = (25 * 40 + 10) * 4;
	t.is(png.data[padIdx], 255);
	t.is(png.data[padIdx + 1], 0);
	t.is(png.data[padIdx + 2], 255);
});

test('padPng: pads horizontally with magenta', t => {
	const buf = makePng(20, 30, {r: 0, g: 100, b: 200});
	const out = padPng(buf, {width: 40, height: 30});
	const png = readPng(out);
	t.is(png.width, 40);
	// Pixel at (5, 5) is original
	const origIdx = (5 * 40 + 5) * 4;
	t.is(png.data[origIdx + 1], 100);
	t.is(png.data[origIdx + 2], 200);
	// Pixel at (30, 5) is in the right pad region — magenta
	const padIdx = (5 * 40 + 30) * 4;
	t.is(png.data[padIdx], 255);
	t.is(png.data[padIdx + 1], 0);
	t.is(png.data[padIdx + 2], 255);
});

test('padPng: refuses to shrink', t => {
	const buf = makePng(40, 30);
	t.throws(() => padPng(buf, {width: 20, height: 30}), {
		message: /cannot shrink/i,
	});
});

test('padToMatch: identical sizes pass through unchanged', t => {
	const a = makePng(20, 20);
	const b = makePng(20, 20);
	const result = padToMatch(a, b);
	t.false(result.padded);
	t.is(result.designPng, a);
	t.is(result.livePng, b);
	t.deepEqual(result.canvas, {width: 20, height: 20});
});

test('padToMatch: pads the shorter image to the taller height', t => {
	const design = makePng(20, 30, {r: 0, g: 200, b: 0});
	const live = makePng(20, 20, {r: 200, g: 0, b: 0});
	const result = padToMatch(design, live);
	t.true(result.padded);
	t.deepEqual(result.canvas, {width: 20, height: 30});

	const livePadded = readPng(result.livePng);
	t.is(livePadded.height, 30);
	// Bottom pad region is magenta
	const padIdx = (25 * 20 + 10) * 4;
	t.is(livePadded.data[padIdx], 255);
	t.is(livePadded.data[padIdx + 2], 255);
});

test('padToMatch: pads to max width × max height when both differ', t => {
	const design = makePng(20, 40);
	const live = makePng(30, 20);
	const result = padToMatch(design, live);
	t.true(result.padded);
	t.deepEqual(result.canvas, {width: 30, height: 40});
});

test('PAD_MAGENTA exports the conventional fill', t => {
	t.deepEqual(PAD_MAGENTA, {r: 255, g: 0, b: 255, a: 255});
});
