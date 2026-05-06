// Uploads a local file into the WordPress media library via the
// `wp neptune media-upload` subcommand and returns its attachment id +
// public URL. Used by the setup flow to register a placeholder image
// that build/refine commands reference for any wp:image block.
import {b64Arg, runNeptuneCli} from './neptune-cli.js';
import {dNumber, dObject, dString} from './decode.js';
import type {StudioSession} from '../integrations/studio/mcp.js';

export type UploadedMedia = {
	id: number;
	url: string;
	filename: string;
};

const dUploadResult = dObject({
	id: dNumber,
	url: dString,
	filename: dString,
});

export async function uploadMedia(
	session: StudioSession,
	nameOrPath: string,
	sourcePath: string,
): Promise<UploadedMedia> {
	return runNeptuneCli(
		session,
		nameOrPath,
		'media-upload',
		{source: b64Arg(sourcePath)},
		dUploadResult,
	);
}
