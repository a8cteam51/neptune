// Imports a single file (anywhere on disk) into the WordPress media
// library by staging it inside wp-content/uploads/ first (PHP's
// open_basedir requirement), running `wp media import`, then deleting
// the staged copy. Each call returns the new attachment's id and
// permalink-style URL.
//
// `wp media import` does not move the source file — it copies it to
// the canonical uploads/<year>/<month>/ path and writes an attachment
// row pointing there. The staged file at the import source path is
// left behind, so we always remove it ourselves.
import {copyFile, mkdir, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {basename, join, relative} from 'node:path';
import {shellSingleQuote, wpCli} from '../../lib/wp-cli.js';
import type {StudioSession} from './mcp.js';

export type MediaImportResult = {
	id: number;
	url: string;
};

export async function importMediaFile(
	session: StudioSession,
	wpRoot: string,
	sourceAbs: string,
): Promise<MediaImportResult> {
	const uploadsAbs = join(wpRoot, 'wp-content', 'uploads');
	// Stage inside a per-call unique subdir rather than uploads/<basename>.
	// Two sources that share a basename (e.g. each pull's screenshot.png, or
	// a logo.png shipped by multiple packages) would otherwise collide: the
	// copyFile would overwrite, and one call's `rm` in finally could delete
	// a file another call still needs. The subdir keeps the original
	// basename (so the attachment is named correctly) while isolating it.
	const stageDir = join(uploadsAbs, `.neptune-stage-${randomUUID()}`);
	await mkdir(stageDir, {recursive: true});
	const stagedAbs = join(stageDir, basename(sourceAbs));
	await copyFile(sourceAbs, stagedAbs);
	const stagedRel = relative(wpRoot, stagedAbs);
	try {
		const idRaw = await wpCli(
			session,
			wpRoot,
			`media import ${shellSingleQuote(stagedRel)} --porcelain`,
		);
		const id = Number.parseInt(idRaw.trim(), 10);
		if (!Number.isFinite(id) || id <= 0) {
			throw new Error(
				`wp media import returned non-numeric id: ${JSON.stringify(idRaw)}`,
			);
		}
		const urlRaw = await wpCli(session, wpRoot, `post get ${id} --field=guid`);
		const url = urlRaw.trim();
		if (url === '') {
			throw new Error(`wp post get returned empty guid for id=${id}`);
		}
		return {id, url};
	} finally {
		try {
			await rm(stageDir, {recursive: true, force: true});
		} catch {
			// Cleanup failures shouldn't mask the import result; the
			// staging dir is harmless if left behind.
		}
	}
}
