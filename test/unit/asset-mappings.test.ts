import test from 'ava';
import {formatAssetMappingsContext} from '../../source/lib/asset-mappings.js';

test('returns null when no assets', t => {
	t.is(formatAssetMappingsContext(undefined), null);
	t.is(formatAssetMappingsContext([]), null);
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
