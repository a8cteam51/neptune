// Uploads each downloaded asset into the WordPress media library,
// returning the constName→media mapping (with each asset's `kind`)
// that gets persisted in the pull's meta.json. Build agents receive
// this mapping so they can swap localhost:3845 references for real
// attachment ids without re-fetching anything.
//
// Inputs are uniformly raster (PNG/JPG/GIF/WEBP). SVGs from the
// design have already been rasterized to PNG and triaged upstream —
// see source/integrations/figma/svg-triage.ts. WP's default SVG
// upload restrictions therefore never come into play here.
//
// Each pull opens its own Studio session: media imports are sequential
// (wp-cli is one tool call per file) and we tolerate a session drop
// between assets — partial mappings are still useful, callers can
// re-pull to fill the gaps.
import {openStudioSession} from './mcp.js';
import {importMediaFile} from './media-import.js';
import type {DownloadedAsset} from '../figma/assets-fetch.js';
import type {LogEvent} from '../../lib/event-list.js';
import type {PulledAsset} from '../../lib/types.js';

export async function uploadPulledAssets(
	wpRoot: string,
	assets: DownloadedAsset[],
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
): Promise<PulledAsset[]> {
	if (assets.length === 0) return [];
	onEvent({
		kind: 'step',
		message: `Importing ${assets.length} asset${assets.length === 1 ? '' : 's'} into the WP media library…`,
	});
	const session = await openStudioSession({signal});
	const out: PulledAsset[] = [];
	try {
		for (const asset of assets) {
			if (signal.aborted) throw new Error('Asset upload aborted.');
			const result = await importMediaFile(session, wpRoot, asset.path);
			out.push({
				constName: asset.constName,
				filename: asset.filename,
				mediaId: result.id,
				mediaUrl: result.url,
				kind: asset.kind,
			});
			onEvent({
				kind: 'step',
				message: `Imported ${asset.filename} → id=${result.id} (${asset.constName}, ${asset.kind})`,
			});
		}
	} finally {
		session.close();
	}
	return out;
}
