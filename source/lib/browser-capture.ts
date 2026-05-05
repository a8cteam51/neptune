// Headless-Chromium screenshot at a controllable viewport size. We
// drive Playwright directly because Studio MCP's `take_screenshot` only
// supports the desktop/mobile presets, which forces a layout mismatch
// against most Figma designs.
//
// Two capture modes:
//
//   * No `selector`: viewport-only screenshot at width × height. The
//     resulting PNG dimensions are exactly width × height. Used for
//     full-page templates.
//
//   * With `selector`: locator.screenshot() captures only that element.
//     Width/height still drive the browser viewport (so layout reflows
//     correctly), but the resulting PNG is sized to the element's
//     bounding box. Used for header/footer template parts: rendering
//     happens on the homepage, but we only want the part itself.
//     Caller is responsible for verifying the resulting dimensions
//     match its design before pixel-diffing.
//
// DPR is locked to 1 so design.width pixels equal browser.width pixels.
import {chromium, type Browser, type BrowserContext} from 'playwright';

export type CaptureOptions = {
	url: string;
	width: number;
	height: number;
	signal?: AbortSignal;
	timeoutMs?: number;
	selector?: string;
};

export async function captureAtSize(
	options: CaptureOptions,
): Promise<Buffer> {
	const {
		url,
		width,
		height,
		signal,
		timeoutMs = 30_000,
		selector,
	} = options;

	if (signal?.aborted) throw new Error('Browser capture aborted');

	let browser: Browser | undefined;
	let context: BrowserContext | undefined;
	const onAbort = () => {
		void browser?.close().catch(() => {});
	};
	signal?.addEventListener('abort', onAbort, {once: true});

	try {
		browser = await chromium.launch({headless: true});
		context = await browser.newContext({
			viewport: {width, height},
			deviceScaleFactor: 1,
			reducedMotion: 'reduce',
		});
		const page = await context.newPage();
		page.setDefaultTimeout(timeoutMs);
		await page.goto(url, {waitUntil: 'networkidle', timeout: timeoutMs});

		if (selector) {
			const locator = page.locator(selector).first();
			const count = await page.locator(selector).count();
			if (count === 0) {
				throw new Error(
					`Selector "${selector}" not found on ${url}. ` +
						'Refine assumes the live page contains the element corresponding to the template part.',
				);
			}
			return await locator.screenshot({
				type: 'png',
				animations: 'disabled',
				caret: 'hide',
			});
		}

		return await page.screenshot({
			type: 'png',
			fullPage: false,
			clip: {x: 0, y: 0, width, height},
			animations: 'disabled',
			caret: 'hide',
		});
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
}

// Maps a template part role to the CSS selector that targets the
// rendered template part on the live page. The convention is the
// `data-template-part` attribute on the part wrapper, keyed by the
// part's slug — this is more reliable than semantic tags (themes can
// override `tagName`) and avoids matching unrelated `<header>` /
// `<footer>` elements elsewhere on the page.
export type CaptureRole = 'header' | 'footer' | 'page';

export function selectorForRole(role: CaptureRole): string | undefined {
	if (role === 'header') return '[data-template-part="header"]';
	if (role === 'footer') return '[data-template-part="footer"]';
	return undefined;
}
