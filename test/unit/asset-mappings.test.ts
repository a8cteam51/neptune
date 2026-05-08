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
		},
		{
			constName: 'imgFoot',
			filename: 'bbb.jpg',
			mediaId: 124,
			mediaUrl: 'http://localhost:8881/wp-content/uploads/2026/05/bbb.jpg',
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
		/imgFoot → id=124, url=http:\/\/localhost:8881\/wp-content\/uploads\/2026\/05\/bbb\.jpg/,
	);
	// Must steer the agent away from emitting empty wp:image and
	// point at the skill's structured-replacement guidance.
	t.regex(out!, /do NOT emit a wp:image/);
	t.regex(out!, /Handling SVG and unmapped image references/);
	t.regex(out!, /Empty wp:image .* is forbidden/);
});
