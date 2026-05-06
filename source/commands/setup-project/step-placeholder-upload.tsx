import React, {useRef} from 'react';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import EventStep from '../../lib/event-step.js';
import type {LogEvent} from '../../lib/event-list.js';
import {openStudioSession} from '../../integrations/studio/mcp.js';
import {uploadMedia, type UploadedMedia} from '../../lib/media-upload.js';
import type {NeptuneConfig} from './types.js';

// Walk up from dist/commands/setup-project/step-placeholder-upload.js
// to the package root where placeholder.jpg ships.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER_PATH = resolve(moduleDir, '..', '..', '..', 'placeholder.jpg');

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
	yield {kind: 'step', message: `Uploading ${PLACEHOLDER_PATH}`};

	const session = await openStudioSession({signal});
	try {
		const result = await uploadMedia(session, wpRoot, PLACEHOLDER_PATH);
		uploadedRef.current = result;
		yield {
			kind: 'success',
			message: `Uploaded ${result.filename} (id=${result.id}) → ${result.url}`,
		};
	} finally {
		session.close();
	}
}
