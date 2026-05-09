// Formats the per-pull WP media library mapping for inclusion in a
// build or refine agent's prompt. The mapping tells the agent that a
// specific `const imgFoo = "http://localhost:3845/..."` declaration
// in code.tsx has already been imported into the media library at a
// known attachment id and URL — the agent should emit those values
// instead of the localhost reference (or instead of an invented path).
//
// Returns null when there are no mappings, so callers can decide
// whether to add a contextless "no images uploaded" note or simply
// skip the section entirely.
import type {PulledAsset} from './types.js';

export function formatAssetMappingsContext(
	assets: PulledAsset[] | undefined,
): string | null {
	if (!assets || assets.length === 0) return null;
	const lines: string[] = [
		'The following constants in code.tsx point to images already imported into the WordPress media library. When emitting any wp:image (or any other block whose markup references one of these constants), use the matching id and URL — do NOT use the localhost:3845 URL and do NOT invent a different path.',
		'',
		'All entries are PNG/JPG/GIF/WEBP rasters. SVGs from the design were either rasterized to PNG (for valuable artwork: logos, brand marks, illustrations, content icons) or discarded as decoration before this list was built.',
		'',
	];
	for (const asset of assets) {
		lines.push(
			`  - ${asset.constName} → id=${asset.mediaId}, url=${asset.mediaUrl}`,
		);
	}
	lines.push('');
	lines.push(
		'For any image whose source constant is NOT in this list, do NOT emit a wp:image at all. The unmapped refs are typically decorative SVGs (dividers, ornaments, gradient overlays) that the triage step deliberately discarded — see the skill\'s "Handling SVG and unmapped image references" section for the structured replacement (border / wp:separator / background / drop / wp:html as last resort). Empty wp:image (src="" with no id) is forbidden.',
	);
	return lines.join('\n');
}
