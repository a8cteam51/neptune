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
	await mkdir(uploadsAbs, {recursive: true});
	const stagedAbs = join(uploadsAbs, basename(sourceAbs));
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
			await rm(stagedAbs, {force: true});
		} catch {
			// Cleanup failures shouldn't mask the import result; the
			// staging file is harmless if left behind.
		}
	}
}
