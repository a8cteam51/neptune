// Compares each non-special pull's screenshot.png pixel dimensions
// against the width/height declared on the first element in
// metadata.xml (currently either <instance> or <frame> depending on
// what the user selected in Figma). Figma's MCP sometimes returns
// scaled-down screenshots, which this command surfaces.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {listPulls, writePullMeta} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

export default function VerifyScreenshots({activeProject, onDone}: Props) {
	const [events, setEvents] = useState<LogEvent[]>([]);
	const [status, setStatus] = useState<'running' | 'success' | 'error'>(
		'running',
	);
	const [error, setError] = useState('');

	useEffect(() => {
		const controller = new AbortController();

		(async () => {
			try {
				for await (const ev of verifyScreenshots(
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
				Verify screenshots
			</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{status === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>
						✓ Verification complete.
					</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
			{status === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>
						✗ Verification failed.
					</Text>
					<Text color="red">{error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
		</Box>
	);
}

async function* verifyScreenshots(
	projectDir: string,
	signal: AbortSignal,
): AsyncGenerator<LogEvent> {
	const pulls = await listPulls(projectDir);
	const regular = pulls.filter(p => p.special === undefined);

	if (regular.length === 0) {
		throw new Error(
			'No regular pulls found in design/ — pull a non-special template first.',
		);
	}

	yield {
		kind: 'step',
		message: `Checking ${regular.length} pull${
			regular.length === 1 ? '' : 's'
		}…`,
	};

	let matched = 0;
	let mismatched = 0;

	for (const pull of regular) {
		if (signal.aborted) return;
		const pullDir = join(projectDir, 'design', pull.slug);
		const xmlPath = join(pullDir, 'metadata.xml');
		const pngPath = join(pullDir, 'screenshot.png');

		let xml: string;
		try {
			xml = await readFile(xmlPath, 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				yield {kind: 'warn', message: `${pull.slug}: no metadata.xml`};
				continue;
			}
			throw err;
		}

		const expected = parseRootElementSize(xml);
		if (!expected) {
			yield {
				kind: 'warn',
				message: `${pull.slug}: first element in metadata.xml missing width/height`,
			};
			continue;
		}

		if (
			pull.expectedWidth !== expected.width ||
			pull.expectedHeight !== expected.height
		) {
			await writePullMeta(projectDir, pull.slug, {
				...pull,
				expectedWidth: expected.width,
				expectedHeight: expected.height,
			});
		}

		let pngBuf: Buffer;
		try {
			pngBuf = await readFile(pngPath);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				yield {kind: 'warn', message: `${pull.slug}: no screenshot.png`};
				continue;
			}
			throw err;
		}

		const actual = readPngSize(pngBuf);
		if (!actual) {
			yield {
				kind: 'warn',
				message: `${pull.slug}: screenshot.png is not a valid PNG`,
			};
			continue;
		}

		const sizesMatch =
			actual.width === expected.width && actual.height === expected.height;

		if (sizesMatch) {
			matched++;
			yield {
				kind: 'success',
				message: `${pull.slug}: matches (${actual.width}×${actual.height})`,
			};
		} else {
			mismatched++;
			yield {
				kind: 'warn',
				message: `${pull.slug}: mismatch — metadata ${expected.width}×${expected.height}, screenshot ${actual.width}×${actual.height}`,
			};
		}
	}

	yield {
		kind: 'step',
		message: `Done — ${matched} matched, ${mismatched} mismatched`,
	};
}

// Reads width/height from the first element in metadata.xml. The
// element is whatever the user selected in Figma — currently either
// <instance> (component instance) or <frame> (raw frame). XML prolog
// (<?xml … ?>), DOCTYPE, and comments are skipped because the leading
// `<?` / `<!` are excluded by the [a-zA-Z] anchor on the tag name.
export function parseRootElementSize(
	xml: string,
): {width: number; height: number} | null {
	const m = /<([a-zA-Z][\w-]*)\b[^>]*>/.exec(xml);
	if (!m) return null;
	const tag = m[0];
	const w = /\bwidth="([0-9.]+)"/.exec(tag)?.[1];
	const h = /\bheight="([0-9.]+)"/.exec(tag)?.[1];
	if (w === undefined || h === undefined) return null;
	const width = Number(w);
	const height = Number(h);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	return {width, height};
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function readPngSize(
	buf: Buffer,
): {width: number; height: number} | null {
	if (buf.length < 24) return null;
	for (let i = 0; i < 8; i++) {
		if (buf[i] !== PNG_SIGNATURE[i]) return null;
	}
	if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
	return {
		width: buf.readUInt32BE(16),
		height: buf.readUInt32BE(20),
	};
}
