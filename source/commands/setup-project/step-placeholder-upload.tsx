import React, {useRef} from 'react';
import {access} from 'node:fs/promises';
import {resolve} from 'node:path';
import EventStep from '../../lib/event-step.js';
import type {LogEvent} from '../../lib/event-list.js';
import {openStudioSession} from '../../integrations/studio/mcp.js';
import {shellSingleQuote, wpCli} from '../../lib/wp-cli.js';
import type {NeptuneConfig} from './types.js';

// The placeholder image ships at <theme>/assets/placeholder.jpg in the
// theme scaffold, so the source is already inside Studio's open_basedir
// — no host-side staging needed.

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
			start={async signal => {
				const themeSlug = config.themeSlug;
				if (!themeSlug) {
					throw new Error(
						'themeSlug missing from neptune-config — run the theme step first.',
					);
				}
				return runUpload(projectDir, themeSlug, signal, uploadedRef);
			}}
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
	themeSlug: string,
	signal: AbortSignal,
	uploadedRef: React.MutableRefObject<UploadedMedia | null>,
): AsyncGenerator<LogEvent> {
	const wpRoot = resolve(projectDir, 'wordpress');
	const sourceRel = `wp-content/themes/${themeSlug}/assets/placeholder.jpg`;
	const sourceAbs = resolve(wpRoot, sourceRel);

	// Verify upfront so the user gets a clear "missing file" message
	// instead of wp-cli's noisier import failure.
	try {
		await access(sourceAbs);
	} catch {
		throw new Error(
			`Placeholder image not found at ${sourceAbs}. Confirm the theme scaffold ships assets/placeholder.jpg.`,
		);
	}

	yield {kind: 'step', message: `Importing ${sourceRel} into the media library…`};

	const session = await openStudioSession({signal});
	try {
		const idRaw = await wpCli(
			session,
			wpRoot,
			`media import ${shellSingleQuote(sourceRel)} --porcelain`,
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
	}
}
