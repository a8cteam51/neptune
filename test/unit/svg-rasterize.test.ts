import test from 'ava';
import {
	computeRenderDims,
	parseIntrinsicDims,
	parseViewBox,
} from '../../source/lib/svg-rasterize.js';

test('parseViewBox: standard space-separated', t => {
	t.deepEqual(
		parseViewBox('<svg viewBox="0 0 64 64"></svg>'),
		{w: 64, h: 64},
	);
});

test('parseViewBox: figma-style with decimal sizes', t => {
	t.deepEqual(
		parseViewBox(
			'<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" width="100%" height="100%" overflow="visible" style="display: block;" viewBox="0 0 148.145 22" fill="none">',
		),
		{w: 148.145, h: 22},
	);
});

test('parseViewBox: comma-separated values', t => {
	t.deepEqual(
		parseViewBox('<svg viewBox="0,0,200,60"></svg>'),
		{w: 200, h: 60},
	);
});

test('parseViewBox: returns undefined when missing', t => {
	t.is(parseViewBox('<svg></svg>'), undefined);
});

test('parseViewBox: returns undefined when w/h non-positive', t => {
	t.is(parseViewBox('<svg viewBox="0 0 0 0"></svg>'), undefined);
});

test('parseIntrinsicDims: absolute pixel width/height', t => {
	t.deepEqual(
		parseIntrinsicDims('<svg width="200" height="60"></svg>'),
		{w: 200, h: 60},
	);
});

test('parseIntrinsicDims: ignores percentage values', t => {
	t.is(
		parseIntrinsicDims('<svg width="100%" height="100%" viewBox="0 0 200 60"></svg>'),
		undefined,
	);
});

test('parseIntrinsicDims: only matches root <svg> attrs, not inner elements', t => {
	const svg = '<svg viewBox="0 0 64 64"><rect width="32" height="32"/></svg>';
	t.is(parseIntrinsicDims(svg), undefined);
});

test('computeRenderDims: respects intrinsic px when within max box', t => {
	t.deepEqual(
		computeRenderDims('<svg width="200" height="60"></svg>', 1024, 1024),
		{width: 200, height: 60},
	);
});

test('computeRenderDims: scales intrinsic px down to fit max box', t => {
	const dims = computeRenderDims(
		'<svg width="2000" height="600"></svg>',
		1024,
		1024,
	);
	t.is(dims.width, 1024);
	t.is(dims.height, 307); // 600 * (1024/2000)
});

test('computeRenderDims: uses viewBox when intrinsic dims are percentage-based', t => {
	const figmaShape =
		'<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 148.145 22"></svg>';
	const dims = computeRenderDims(figmaShape, 1024, 1024);
	// Aspect ratio ~6.73:1 — width hits the cap.
	t.is(dims.width, 1024);
	// 22 * (1024/148.145) ≈ 152
	t.is(dims.height, 152);
});

test('computeRenderDims: viewBox path upscales tiny icons', t => {
	const dims = computeRenderDims('<svg viewBox="0 0 24 24"></svg>', 1024, 1024);
	t.is(dims.width, 1024);
	t.is(dims.height, 1024);
});

test('computeRenderDims: viewBox path preserves aspect for tall shapes', t => {
	const dims = computeRenderDims(
		'<svg viewBox="0 0 100 400"></svg>',
		1024,
		1024,
	);
	// Height hits the cap; width = 100 * (1024/400) = 256
	t.is(dims.width, 256);
	t.is(dims.height, 1024);
});

test('computeRenderDims: falls back to 300x150 when no shape info', t => {
	t.deepEqual(computeRenderDims('<svg></svg>', 1024, 1024), {
		width: 300,
		height: 150,
	});
});
