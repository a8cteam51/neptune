// Pixel diff via odiff-bin. Replaces the previous pixelmatch+pngjs
// pipeline: odiff is much faster, ships its own platform binary, and
// returns a structured result we can branch on without re-decoding the
// image. Diff PNG is written to `diffPath` when a pixel-diff is
// produced; layout-diff results do not produce a diff image (callers
// should fall back to comparing the source images directly).
import {compare, type ODiffOptions, type ODiffResult} from 'odiff-bin';

export type DiffOptions = Partial<{
	threshold: number;
	antialiasing: boolean;
}>;

export type DiffOutcome =
	| {ok: true; match: true}
	| {
			ok: true;
			match: false;
			kind: 'pixel-diff';
			diffCount: number;
			diffPercentage: number;
	  }
	| {
			ok: true;
			match: false;
			kind: 'layout-diff';
	  }
	| {
			ok: false;
			reason: 'file-not-exists';
			file?: string;
	  };

export async function diffImages(
	designPath: string,
	livePath: string,
	diffPath: string,
	options: DiffOptions = {},
): Promise<DiffOutcome> {
	const opts: ODiffOptions = {
		threshold: options.threshold ?? 0.1,
		antialiasing: options.antialiasing ?? true,
		failOnLayoutDiff: true,
		noFailOnFsErrors: true,
	};
	const result: ODiffResult = await compare(
		designPath,
		livePath,
		diffPath,
		opts,
	);

	if (result.match) return {ok: true, match: true};

	if (result.reason === 'pixel-diff') {
		return {
			ok: true,
			match: false,
			kind: 'pixel-diff',
			diffCount: result.diffCount,
			diffPercentage: result.diffPercentage,
		};
	}

	if (result.reason === 'layout-diff') {
		return {ok: true, match: false, kind: 'layout-diff'};
	}

	return {
		ok: false,
		reason: 'file-not-exists',
		file: result.file,
	};
}
