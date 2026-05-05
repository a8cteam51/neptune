// Walks design/<slug>/code.tsx for every non-special pull and copies any
// top-level function that isn't the default export into patterns/<Name>.tsx.
// Duplicate names (across pulls or against existing files in patterns/) are
// skipped — first-seen wins.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {listPulls} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {parseTopLevelFunctions} from './extract-patterns-parse.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

export default function ExtractPatterns({activeProject, onDone}: Props) {
	const [events, setEvents] = useState<LogEvent[]>([]);
	const [status, setStatus] = useState<'running' | 'success' | 'error'>(
		'running',
	);
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				for await (const ev of extractPatterns(activeProject.dir)) {
					if (cancelled) return;
					setEvents(prev => [...prev, ev]);
				}
				if (!cancelled) setStatus('success');
			} catch (err) {
				if (!cancelled) {
					setStatus('error');
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		})();

		return () => {
			cancelled = true;
		};
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
			<Text bold color="cyan">Extract patterns</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{status === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>✓ Patterns extracted.</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
			{status === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>✗ Extraction failed.</Text>
					<Text color="red">{error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
		</Box>
	);
}

async function* extractPatterns(
	projectDir: string,
): AsyncGenerator<LogEvent> {
	const pulls = await listPulls(projectDir);
	const regular = pulls.filter(p => p.special === undefined);

	if (regular.length === 0) {
		throw new Error(
			'No regular pulls found in design/ — pull a non-special template first.',
		);
	}

	const patternsDir = join(projectDir, 'patterns');
	await mkdir(patternsDir, {recursive: true});

	const seen = new Set<string>();
	try {
		for (const f of await readdir(patternsDir)) {
			if (f.endsWith('.tsx')) seen.add(f.slice(0, -4));
		}
	} catch {
		/* empty patterns dir, fine */
	}

	yield {
		kind: 'step',
		message: `Scanning ${regular.length} pull${
			regular.length === 1 ? '' : 's'
		}…`,
	};

	let totalWritten = 0;
	let totalSkipped = 0;

	for (const pull of regular) {
		const codePath = join(projectDir, 'design', pull.slug, 'code.tsx');
		let code: string;
		try {
			code = await readFile(codePath, 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				yield {
					kind: 'warn',
					message: `${pull.slug}: no code.tsx, skipping`,
				};
				continue;
			}
			throw err;
		}

		const {defaultName, functions} = parseTopLevelFunctions(code);
		const patterns = functions.filter(f => f.name !== defaultName);

		if (patterns.length === 0) {
			yield {
				kind: 'step',
				message: `${pull.slug}: no patterns found`,
			};
			continue;
		}

		let written = 0;
		let skipped = 0;
		for (const fn of patterns) {
			if (seen.has(fn.name)) {
				skipped++;
				continue;
			}
			seen.add(fn.name);
			const out = join(patternsDir, `${fn.name}.tsx`);
			const body = code.slice(fn.start, fn.end + 1).trimEnd() + '\n';
			await writeFile(out, body);
			written++;
		}

		totalWritten += written;
		totalSkipped += skipped;

		yield {
			kind: 'step',
			message: `${pull.slug}: ${written} written, ${skipped} duplicate${
				skipped === 1 ? '' : 's'
			}`,
		};
	}

	yield {
		kind: 'step',
		message: `Done — ${totalWritten} pattern${
			totalWritten === 1 ? '' : 's'
		} in patterns/, ${totalSkipped} duplicate${
			totalSkipped === 1 ? '' : 's'
		} skipped`,
	};
}
