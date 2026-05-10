// Formats the per-pull WP media library mapping for inclusion in a
// build or refine agent's prompt. The mapping tells the agent that a
// specific `const imgFoo = "http://localhost:3845/..."` declaration
// in code.tsx has already been imported into the media library at a
// known attachment id and URL — the agent should emit those values
// instead of the localhost reference (or instead of an invented path).
//
// Discarded refs (SVGs the triage agent rejected as decoration, plus
// any that failed to rasterize) are listed separately with a short
// description of what each image was, so the build/refine agent can
// pick the right structural replacement (border / wp:separator /
// background / drop / wp:html) per ref instead of guessing from
// code.tsx alone.
//
// Returns null only when both lists are empty, so callers can decide
// whether to skip the section entirely.
import type {DiscardedAsset, PulledAsset} from './types.js';

export function formatAssetMappingsContext(
	assets: PulledAsset[] | undefined,
	discarded: DiscardedAsset[] | undefined = undefined,
): string | null {
	const hasAssets = assets !== undefined && assets.length > 0;
	const hasDiscards = discarded !== undefined && discarded.length > 0;
	if (!hasAssets && !hasDiscards) return null;

	const lines: string[] = [];

	if (hasAssets) {
		lines.push(
			'The following constants in code.tsx point to images already imported into the WordPress media library. When emitting any wp:image (or any other block whose markup references one of these constants), use the matching id and URL — do NOT use the localhost:3845 URL and do NOT invent a different path.',
			'',
			'All entries are PNG/JPG/GIF/WEBP rasters. SVGs from the design were either rasterized to PNG (for valuable artwork: logos, brand marks, illustrations, content icons) or discarded as decoration before this list was built.',
			'',
		);
		for (const asset of assets!) {
			lines.push(
				`  - ${asset.constName} → id=${asset.mediaId}, url=${asset.mediaUrl}`,
			);
		}
		lines.push('');
	} else {
		lines.push(
			'No constants in code.tsx have a corresponding entry in the WordPress media library — every image reference in this design was either an SVG the triage agent classified as decoration, or an SVG that failed to rasterize.',
			'',
		);
	}

	if (hasDiscards) {
		lines.push(
			'The following constants from code.tsx were intentionally NOT imported into the media library. Each line gives the constName plus a short description of what the image was — use these descriptions to pick a structural replacement per the skill\'s "Handling SVG and unmapped image references" section (border / wp:separator / background / drop / wp:html as last resort). DO NOT emit a wp:image for any of these constants — empty wp:image (src="" with no id) is forbidden and renders as a broken-image placeholder.',
			'',
		);
		for (const d of discarded!) {
			const cause = d.cause === 'renderFail' ? ' [render failure]' : '';
			lines.push(`  - ${d.constName}${cause}: ${d.description}`);
		}
		lines.push('');
		lines.push(
			'For any image const that appears in NEITHER list above, treat it as if it appeared in the discarded list — it is unmapped, and the same structural-replacement rules apply.',
		);
	} else {
		lines.push(
			'For any image whose source constant is NOT in the list above, do NOT emit a wp:image at all. The unmapped refs are typically decorative SVGs (dividers, ornaments, gradient overlays) that the triage step deliberately discarded — see the skill\'s "Handling SVG and unmapped image references" section for the structured replacement (border / wp:separator / background / drop / wp:html as last resort). Empty wp:image (src="" with no id) is forbidden.',
		);
	}

	return lines.join('\n');
}
