// Generates the refine loop's inputs from a Claude Design package. The
// refine loop (refine-templates / template-diff) is driven entirely by
// design/<slug>/meta.json + design/<slug>/screenshot.png: it captures the
// live WP render and pixel-diffs it against that screenshot. Figma fills
// screenshot.png from the Figma render; here we render the package's
// top-level static HTML reference to a PNG and synthesize a minimal
// PullMeta, so the loop works unchanged.
//
// Only templates that ship a matching static reference get a synthetic
// pull (you can't diff against a design you don't have). The PullMeta is
// deliberately tiny — it describes a real template that really exists.
import {writeFileAtomic} from '../../lib/atomic-write.js';
import {mkdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureAtSize} from '../../lib/browser-capture.js';
import {writePullMeta} from '../../lib/design-walk.js';
import {defaultTitleFromSlug} from '../../lib/wp-templates.js';
import type {LogEvent} from '../../lib/event-list.js';
import type {Loaded} from '../../commands/setup-project/types.js';
import type {PullMeta} from '../../lib/types.js';
import {previewPathForTemplate, type ClaudeDesignManifest} from './contract.js';

export type SyntheticPullsDeps = {
	captureAtSize?: typeof captureAtSize;
};

// Fixed capture height. The diff clips both the design render and the live
// render to the same dimensions, so a tall canvas captures the meaningful
// top of the page consistently on both sides; padToMatch reconciles any
// residual height delta during diffing.
const CAPTURE_HEIGHT = 2400;

function parseWidthPx(themeJson: unknown, fallback: number): number {
	if (typeof themeJson !== 'object' || themeJson === null) return fallback;
	const settings = (themeJson as Record<string, unknown>)['settings'];
	const layout =
		typeof settings === 'object' && settings !== null
			? (settings as Record<string, unknown>)['layout']
			: undefined;
	const wide =
		typeof layout === 'object' && layout !== null
			? (layout as Record<string, unknown>)['wideSize']
			: undefined;
	if (typeof wide === 'string') {
		const m = /^(\d+(?:\.\d+)?)px$/.exec(wide.trim());
		if (m) return Math.round(Number(m[1]));
	}
	return fallback;
}

export type SyntheticPullSummary = {
	slug: string;
	templateFile: string;
	previewPath: string;
	previewKnown: boolean;
};

export async function writeSyntheticPulls(
	loaded: Loaded,
	manifest: ClaudeDesignManifest,
	themeJson: unknown,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: SyntheticPullsDeps = {},
): Promise<SyntheticPullSummary[]> {
	const capture = deps.captureAtSize ?? captureAtSize;
	const themeSlug = loaded.config.themeSlug;
	const width = parseWidthPx(themeJson, 1200);
	const out: SyntheticPullSummary[] = [];

	for (const templateFile of manifest.templates) {
		const staticRef = manifest.staticRefs[templateFile];
		if (!staticRef) continue; // no design to diff against
		if (signal.aborted) return out;

		const slug = templateFile.replace(/\.html$/i, '');
		const pageName = defaultTitleFromSlug(slug);
		const preview = previewPathForTemplate(slug);

		onEvent({
			kind: 'step',
			message: `Rendering static reference ${templateFile} (${width}×${CAPTURE_HEIGHT})`,
		});
		let png: Buffer;
		try {
			png = await capture({
				url: pathToFileURL(staticRef).href,
				width,
				height: CAPTURE_HEIGHT,
				signal,
			});
		} catch (err) {
			onEvent({
				kind: 'warn',
				message: `Could not render ${templateFile}: ${err instanceof Error ? err.message : String(err)}. Skipping its refine target.`,
			});
			continue;
		}

		const screenshotPath = join(loaded.dir, 'design', slug, 'screenshot.png');
		await mkdir(dirname(screenshotPath), {recursive: true});
		await writeFileAtomic(screenshotPath, png);

		const meta: PullMeta = {
			pageName,
			slug,
			templateFile,
			previewPath: preview.path,
			themeSlug,
			origin: 'claude-design',
			staticRef,
			pulledAt: new Date().toISOString(),
		};
		await writePullMeta(loaded.dir, slug, meta);

		if (!preview.known) {
			onEvent({
				kind: 'warn',
				message: `Don't know the preview URL for template "${slug}"; defaulted previewPath to "/". Edit design/${slug}/meta.json if the refine diff targets the wrong page.`,
			});
		}
		onEvent({
			kind: 'success',
			message: `Refine target ready: ${slug} → ${preview.path}`,
		});
		out.push({
			slug,
			templateFile,
			previewPath: preview.path,
			previewKnown: preview.known,
		});
	}

	return out;
}
