// Captures every non-special pull's live URL as a full-page JPEG and
// writes it to <projectDir>/screens/<slug>.jpg. Surfaced in the
// End-to-end menu section so the user has a single command to refresh
// share-ready snapshots after a build.
//
// Sizing: each pull declares expectedWidth/expectedHeight in its
// metadata (set during pull-template, verified by verify-screenshots).
// Those drive the browser viewport so layout matches the design;
// fullPage:true means the JPEG height grows past the viewport when the
// rendered page is taller.
//
// URL: getSiteUrl(projectDir) + pull.previewPath. Same resolution path
// as refine-template — depends on Studio knowing about the site.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {writeFileAtomic} from '../lib/atomic-write.js';
import {capturePageJpeg} from '../lib/browser-capture.js';
import {listPulls} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {getSiteUrl} from '../integrations/studio/site.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

export default function CaptureScreens({activeProject, onDone}: Props) {
	const [events, setEvents] = useState<LogEvent[]>([]);
	const [status, setStatus] = useState<'running' | 'success' | 'error'>(
		'running',
	);
	const [error, setError] = useState('');

	useEffect(() => {
		const controller = new AbortController();

		(async () => {
			try {
				for await (const ev of captureScreens(
					activeProject.dir,
					controller.signal,
				)) {
					if (controller.signal.aborted) return;
					setEvents(prev => [...prev, ev]);
				}
				if (!controller.signal.aborted) setStatus('success');
			} catch (err) {
				if (!controller.signal.aborted) {
					setStatus('error');
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		})();

		return () => controller.abort();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useInput(
		() => {
			onDone();
		},
		{isActive: status !== 'running'},
	);

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">
				Capture screens
			</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{status === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>
						✓ All pages captured.
					</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
			{status === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>
						✗ Capture failed.
					</Text>
					<Text color="red">{error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
		</Box>
	);
}

async function* captureScreens(
	projectDir: string,
	signal: AbortSignal,
): AsyncGenerator<LogEvent> {
	const pulls = await listPulls(projectDir);
	const eligible = pulls.filter(
		p => p.special === undefined && typeof p.previewPath === 'string',
	);

	if (eligible.length === 0) {
		throw new Error(
			'No non-special pulls with a previewPath. Run Pull template first.',
		);
	}

	const siteUrl = await getSiteUrl(projectDir);
	if (!siteUrl) {
		throw new Error(
			'Could not resolve the running site URL from ~/.studio/cli.json. Is the site registered with Studio?',
		);
	}

	const screensDir = join(projectDir, 'screens');
	await mkdir(screensDir, {recursive: true});

	yield {
		kind: 'step',
		message: `Capturing ${eligible.length} page${
			eligible.length === 1 ? '' : 's'
		} → screens/`,
	};

	let captured = 0;
	let failed = 0;

	for (const pull of eligible) {
		if (signal.aborted) return;
		const url = siteUrl + (pull.previewPath ?? '/');
		const width = pull.expectedWidth ?? 1280;
		const height = pull.expectedHeight ?? 800;
		const filePath = join(screensDir, `${pull.slug}.jpg`);
		yield {
			kind: 'step',
			message: `${pull.slug}: ${url} @ ${width}×${height}`,
		};
		try {
			const buf = await capturePageJpeg({url, width, height, signal});
			if (signal.aborted) return;
			await writeFileAtomic(filePath, buf);
			captured++;
			yield {
				kind: 'success',
				message: `${pull.slug} → screens/${pull.slug}.jpg (${formatBytes(buf.length)})`,
			};
		} catch (err) {
			if (signal.aborted) return;
			failed++;
			const msg = err instanceof Error ? err.message : String(err);
			yield {kind: 'warn', message: `${pull.slug} failed: ${msg}`};
		}
	}

	yield {
		kind: 'step',
		message: `Done — ${captured} captured, ${failed} failed`,
	};
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
