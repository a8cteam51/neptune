// Rasterizes a batch of SVG files to small PNG buffers. The triage
// agent uses these as vision input, and the kept ones become the
// uploaded media-library artifacts (so WP never has to accept SVG
// MIMEs at all).
//
// One Chromium instance is shared across the batch. Per-SVG rendering
// is best-effort: any failure returns `undefined` for that index and
// (when `onWarn` is supplied) the actual error message is surfaced
// to the caller. The caller decides whether to drop, retry, or
// fall back.
//
// Robustness choices learned from real Figma exports:
//   * `waitUntil: 'domcontentloaded'` — Figma SVGs occasionally embed
//     <image href="…remote…"> or font URLs; waiting for `load` blocks
//     until those subresources resolve, which on a sandbox-blocked
//     network means a 15s timeout per SVG.
//   * `route('**/*', abort)` blocks all subresource fetches so the
//     page settles quickly even when an SVG references something
//     external.
//   * Up-front size resolution — Figma exports almost always look like
//     `<svg width="100%" height="100%" viewBox="0 0 148 22">`; in our
//     inline-block container with no parent dims, "100%" resolves to 0
//     and the screenshot would either fail or get squashed by a
//     fallback. We parse the viewBox (or absolute pixel attrs when
//     present) ourselves and apply explicit width/height inline so the
//     SVG renders at its natural aspect ratio. Inline style wins over
//     the width/height presentation attributes.
//   * `javaScriptEnabled: false` — Figma exports don't carry scripts,
//     and disabling them prevents an exotic SVG from executing
//     anything during render.
import {readFile} from 'node:fs/promises';
import {chromium, type Browser, type BrowserContext, type Page} from 'playwright';

export type RasterizeOptions = {
	maxWidth?: number;
	maxHeight?: number;
	signal?: AbortSignal;
	timeoutMs?: number;
	// Fires once per SVG that fails to render with the underlying
	// error. Lets the caller surface a useful message instead of a
	// generic "could not rasterize" log.
	onWarn?: (path: string, err: unknown) => void;
};

const DEFAULT_MAX_WIDTH = 512;
const DEFAULT_MAX_HEIGHT = 512;
const DEFAULT_TIMEOUT_MS = 15_000;
// Last-resort dimensions when the SVG carries no usable shape
// information (no viewBox, no intrinsic pixel attrs). Matches the
// browser's own default <svg> rendering size — a 2:1 rectangle is
// rare in Figma output but at least avoids slamming an unknown shape
// into a square.
const FALLBACK_WIDTH = 300;
const FALLBACK_HEIGHT = 150;

export async function rasterizeSvgs(
	paths: string[],
	options: RasterizeOptions = {},
): Promise<Array<Buffer | undefined>> {
	if (paths.length === 0) return [];

	const {
		maxWidth = DEFAULT_MAX_WIDTH,
		maxHeight = DEFAULT_MAX_HEIGHT,
		signal,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		onWarn,
	} = options;

	if (signal?.aborted) throw new Error('SVG rasterization aborted');

	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	const onAbort = () => {
		void browser?.close().catch(() => {});
	};
	signal?.addEventListener('abort', onAbort, {once: true});

	const results: Array<Buffer | undefined> = new Array(paths.length).fill(
		undefined,
	);

	try {
		browser = await chromium.launch({headless: true});
		context = await browser.newContext({
			viewport: {width: maxWidth, height: maxHeight},
			deviceScaleFactor: 1,
			javaScriptEnabled: false,
			reducedMotion: 'reduce',
		});
		// Block every subresource. The HTML for setContent doesn't go
		// through routing (it's set via DevTools, not a navigation), so
		// only external references inside the SVG hit this handler — and
		// we want all of those to fail fast rather than hang.
		await context.route('**/*', route => {
			void route.abort().catch(() => {});
		});

		const page = await context.newPage();
		page.setDefaultTimeout(timeoutMs);

		for (let i = 0; i < paths.length; i++) {
			if (signal?.aborted) throw new Error('SVG rasterization aborted');

			try {
				results[i] = await rasterizeOne(page, paths[i]!, maxWidth, maxHeight);
			} catch (err) {
				results[i] = undefined;
				onWarn?.(paths[i]!, err);
			}
		}
	} finally {
		signal?.removeEventListener('abort', onAbort);
		try {
			await context?.close();
		} catch {
			/* best effort */
		}
		try {
			await browser?.close();
		} catch {
			/* best effort */
		}
	}

	return results;
}

async function rasterizeOne(
	page: Page,
	path: string,
	maxWidth: number,
	maxHeight: number,
): Promise<Buffer | undefined> {
	const svg = await readFile(path, 'utf8');
	if (!svg.includes('<svg')) {
		throw new Error('File does not contain an <svg> element');
	}

	const dims = computeRenderDims(svg, maxWidth, maxHeight);

	// Background is left transparent: combined with `omitBackground: true`
	// on the screenshot, this preserves the SVG's alpha channel in the
	// PNG. Without it, a white-fill logo would render as a white square
	// over the page's default white backdrop and become invisible on
	// any non-white surface in WordPress.
	//
	// Width/height are set inline on the element rather than on a
	// `.frame > svg` selector — inline style has higher specificity
	// than presentation attributes (`width="100%"`) and external CSS,
	// so this wins regardless of what the SVG declares.
	const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: transparent; }
.frame { display: inline-block; }
</style></head>
<body><div class="frame">${svg}</div></body></html>`;

	await page.setContent(html, {waitUntil: 'domcontentloaded'});

	const locator = page.locator('.frame > svg').first();
	if ((await page.locator('.frame > svg').count()) === 0) {
		throw new Error('SVG element not parsed into the page');
	}

	await page.evaluate(args => {
		const el = document.querySelector('.frame > svg') as SVGElement | null;
		if (el) {
			el.style.setProperty('display', 'block', 'important');
			el.style.setProperty('width', `${args.w}px`, 'important');
			el.style.setProperty('height', `${args.h}px`, 'important');
		}
	}, {w: dims.width, h: dims.height});

	return await locator.screenshot({
		type: 'png',
		animations: 'disabled',
		omitBackground: true,
	});
}

// Computes the pixel dimensions to render the SVG at, preserving its
// aspect ratio. Strategy:
//   1. Absolute pixel width/height attrs on the root `<svg>` win when
//      both are present — render at those dims, scaled down only if
//      they exceed the max box.
//   2. Otherwise, fall back to viewBox to derive an aspect ratio and
//      scale uniformly to fit the max box (allowing upscaling so that
//      tiny icons still produce a reasonable PNG).
//   3. Last resort: 300×150, matching the browser's default <svg> size.
//      Anything that lands here has no usable shape information.
export function computeRenderDims(
	svg: string,
	maxWidth: number,
	maxHeight: number,
): {width: number; height: number} {
	const intrinsic = parseIntrinsicDims(svg);
	if (intrinsic) {
		const scale = Math.min(maxWidth / intrinsic.w, maxHeight / intrinsic.h, 1);
		return {
			width: Math.max(1, Math.round(intrinsic.w * scale)),
			height: Math.max(1, Math.round(intrinsic.h * scale)),
		};
	}
	const vb = parseViewBox(svg);
	if (vb) {
		const scale = Math.min(maxWidth / vb.w, maxHeight / vb.h);
		return {
			width: Math.max(1, Math.round(vb.w * scale)),
			height: Math.max(1, Math.round(vb.h * scale)),
		};
	}
	return {width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT};
}

// Matches viewBox on the root <svg>: the first occurrence in the
// document. Tolerates space- or comma-separated values and decimals.
const VIEWBOX_RE =
	/viewBox\s*=\s*["']\s*[-+\d.]+[\s,]+[-+\d.]+[\s,]+([-+\d.]+)[\s,]+([-+\d.]+)\s*["']/i;

export function parseViewBox(svg: string): {w: number; h: number} | undefined {
	const m = VIEWBOX_RE.exec(svg);
	if (!m) return undefined;
	const w = Number.parseFloat(m[1]!);
	const h = Number.parseFloat(m[2]!);
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
		return undefined;
	}
	return {w, h};
}

// Matches absolute pixel width/height attributes on the root `<svg>`
// open tag only. Percentage values ("100%") and other units ("em",
// "rem") are deliberately ignored — those don't give us a real size.
export function parseIntrinsicDims(
	svg: string,
): {w: number; h: number} | undefined {
	const tag = /<svg\b[^>]*>/i.exec(svg);
	if (!tag) return undefined;
	const attrW = /\bwidth\s*=\s*["']?\s*([-+\d.]+)\s*(?:px)?\s*["'\s>]/i.exec(
		tag[0],
	);
	const attrH = /\bheight\s*=\s*["']?\s*([-+\d.]+)\s*(?:px)?\s*["'\s>]/i.exec(
		tag[0],
	);
	if (!attrW || !attrH) return undefined;
	const w = Number.parseFloat(attrW[1]!);
	const h = Number.parseFloat(attrH[1]!);
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
		return undefined;
	}
	return {w, h};
}
