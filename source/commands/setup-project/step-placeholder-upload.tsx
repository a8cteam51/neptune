import React, {useRef} from 'react';
import {copyFile, mkdir, rm} from 'node:fs/promises';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import EventStep from '../../lib/event-step.js';
import type {LogEvent} from '../../lib/event-list.js';
import {openStudioSession} from '../../integrations/studio/mcp.js';
import {shellSingleQuote, wpCli} from '../../lib/wp-cli.js';
import type {NeptuneConfig} from './types.js';

// Walk up from dist/commands/setup-project/step-placeholder-upload.js
// to the package root where placeholder.jpg ships.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER_PATH = resolve(moduleDir, '..', '..', '..', 'placeholder.jpg');

type UploadedMedia = {
	id: number;
	url: string;
};

export default function PlaceholderUploadStep({
	projectDir,
	config,
	onComplete,
	onAbort,
}: {
	projectDir: string;
	config: NeptuneConfig;
	onComplete: (updates: Partial<NeptuneConfig>) => void;
	onAbort: (message: string) => void;
}) {
	const uploadedRef = useRef<UploadedMedia | null>(null);

	return (
		<EventStep
			title="Step 7 — Upload placeholder image"
			start={async signal =>
				runUpload(projectDir, signal, uploadedRef)
			}
			onSuccess={() => {
				const uploaded = uploadedRef.current;
				if (!uploaded) {
					onAbort('Upload finished without an attachment id.');
					return;
				}
				onComplete({
					placeholderImage: {id: uploaded.id, url: uploaded.url},
					steps: {...config.steps, placeholderUploaded: true},
				});
			}}
			onAbort={onAbort}
		/>
	);
}

async function* runUpload(
	projectDir: string,
	signal: AbortSignal,
	uploadedRef: React.MutableRefObject<UploadedMedia | null>,
): AsyncGenerator<LogEvent> {
	const wpRoot = resolve(projectDir, 'wordpress');

	// Studio's wp-cli runs in a sandboxed filesystem view, so absolute
	// host paths like /Users/... don't resolve. Stage the placeholder
	// inside the WP install (host-side) and pass wp-cli a path RELATIVE
	// to the WP root — wp-cli resolves it against --path, which works
	// regardless of how Studio virtualizes the filesystem.
	const uploadsDir = resolve(wpRoot, 'wp-content', 'uploads');
	await mkdir(uploadsDir, {recursive: true});
	const stagingPath = resolve(
		uploadsDir,
		`.neptune-placeholder-${Date.now()}.jpg`,
	);
	const stagingRel = relative(wpRoot, stagingPath);

	yield {kind: 'step', message: `Staging placeholder → ${stagingPath}`};
	await copyFile(PLACEHOLDER_PATH, stagingPath);

	const session = await openStudioSession({signal});
	try {
		yield {kind: 'step', message: 'Importing into media library…'};
		const idRaw = await wpCli(
			session,
			wpRoot,
			`media import ${shellSingleQuote(stagingRel)} --porcelain`,
		);
		const id = Number.parseInt(idRaw.trim(), 10);
		if (!Number.isFinite(id) || id <= 0) {
			throw new Error(
				`Could not parse attachment id from wp media import output: ${JSON.stringify(idRaw)}`,
			);
		}

		const urlRaw = await wpCli(
			session,
			wpRoot,
			`post get ${id} --field=guid`,
		);
		const url = urlRaw.trim();
		if (url === '') {
			throw new Error(`wp post get returned empty guid for id=${id}`);
		}

		uploadedRef.current = {id, url};
		yield {
			kind: 'success',
			message: `Uploaded (id=${id}) → ${url}`,
		};
	} finally {
		session.close();
		// Best-effort cleanup; the staging file is harmless if left
		// behind but pollutes the uploads dir.
		await rm(stagingPath, {force: true}).catch(() => {});
	}
}
