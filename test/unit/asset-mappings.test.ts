import test from 'ava';
import {formatAssetMappingsContext} from '../../source/lib/asset-mappings.js';

test('returns null when there are no assets and no discards', t => {
	t.is(formatAssetMappingsContext(undefined), null);
	t.is(formatAssetMappingsContext([]), null);
	t.is(formatAssetMappingsContext(undefined, []), null);
	t.is(formatAssetMappingsContext([], []), null);
});

test('lists each constName → id, url with header + footer guidance', t => {
	const out = formatAssetMappingsContext([
		{
			constName: 'imgHero',
			filename: 'aaa.png',
			mediaId: 123,
			mediaUrl: 'http://localhost:8881/wp-content/uploads/2026/05/aaa.png',
			kind: 'raster',
		},
		{
			constName: 'imgLogo',
			filename: 'bbb.png',
			mediaId: 124,
			mediaUrl: 'http://localhost:8881/wp-content/uploads/2026/05/bbb.png',
			kind: 'raster',
		},
	]);
	t.truthy(out);
	t.regex(out!, /already imported into the WordPress media library/);
	t.regex(
		out!,
		/imgHero → id=123, url=http:\/\/localhost:8881\/wp-content\/uploads\/2026\/05\/aaa\.png/,
	);
	t.regex(
		out!,
		/imgLogo → id=124, url=http:\/\/localhost:8881\/wp-content\/uploads\/2026\/05\/bbb\.png/,
	);
	// Per-asset (kind) annotation is gone — all uploads are raster now.
	t.notRegex(out!, /\(svg\)/);
	t.notRegex(out!, /\(raster\)/);
	// Header should explain that valuable SVGs were rasterized to PNG.
	t.regex(out!, /rasterized to PNG/);
	// Must steer the agent away from emitting empty wp:image for
	// unmapped (i.e. discarded-decorative) refs.
	t.regex(out!, /do NOT emit a wp:image/);
	t.regex(out!, /Handling SVG and unmapped image references/);
	t.regex(out!, /Empty wp:image .* is forbidden/);
});

test('lists discarded refs with their description and cause', t => {
	const out = formatAssetMappingsContext(
		[
			{
				constName: 'imgHero',
				filename: 'aaa.png',
				mediaId: 123,
				mediaUrl: 'http://localhost:8881/wp-content/uploads/2026/05/aaa.png',
				kind: 'raster',
			},
		],
		[
			{
				constName: 'imgDivider',
				filename: 'divider.svg',
				description: 'Horizontal 1px divider line, full-width.',
				cause: 'triage',
			},
			{
				constName: 'imgGradient',
				filename: 'gradient.svg',
				description: 'Decorative gradient blob behind hero section.',
				cause: 'triage',
			},
			{
				constName: 'imgBroken',
				filename: 'broken.svg',
				description: 'Could not rasterize: invalid SVG markup',
				cause: 'renderFail',
			},
		],
	);
	t.truthy(out);
	// Mapped section is still present.
	t.regex(out!, /imgHero → id=123/);
	// Discards section appears with description + render-fail tag.
	t.regex(out!, /imgDivider: Horizontal 1px divider line, full-width\./);
	t.regex(out!, /imgGradient: Decorative gradient blob behind hero section\./);
	t.regex(out!, /imgBroken \[render failure\]: Could not rasterize/);
	// Steers the agent to use the descriptions to pick a structural
	// replacement, and forbids wp:image for discards.
	t.regex(out!, /Handling SVG and unmapped image references/);
	t.regex(out!, /DO NOT emit a wp:image/);
});

test('emits a discards-only section when no assets uploaded', t => {
	const out = formatAssetMappingsContext(undefined, [
		{
			constName: 'imgDivider',
			filename: 'divider.svg',
			description: 'Horizontal 1px divider line, full-width.',
			cause: 'triage',
		},
	]);
	t.truthy(out);
	// No mapped-imports prose.
	t.notRegex(out!, /already imported into the WordPress media library/);
	// Explicit "no media library entries" framing.
	t.regex(out!, /No constants in code\.tsx have a corresponding entry/);
	t.regex(out!, /imgDivider: Horizontal 1px divider line/);
});

test('hints that any unlisted const should be treated as discarded', t => {
	// When discards are listed explicitly, the agent should still treat
	// any const that appears in NEITHER list (e.g. a Figma ref the
	// pipeline didn't see) the same way as a discard.
	const out = formatAssetMappingsContext(
		[
			{
				constName: 'imgHero',
				filename: 'aaa.png',
				mediaId: 1,
				mediaUrl: 'http://localhost:8881/wp-content/uploads/aaa.png',
				kind: 'raster',
			},
		],
		[
			{
				constName: 'imgDivider',
				filename: 'divider.svg',
				description: 'Horizontal 1px divider line, full-width.',
				cause: 'triage',
			},
		],
	);
	t.truthy(out);
	t.regex(out!, /appears in NEITHER list/);
});
