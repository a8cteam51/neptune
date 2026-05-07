// Discovers candidate pattern names by parsing every non-special pull's
// design/<slug>/code.tsx for top-level functions that aren't the default
// export. Presents the unique names in a checkbox list; the selected
// subset is persisted to neptune-config.json (config.patterns) and
// drives the Pull pattern picker. No on-disk pattern files are written
// here — Pull pattern fetches each chosen pattern's assets from Figma.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import MultiSelect from '../lib/multi-select.js';
import {listPulls} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {parseTopLevelFunctions} from './extract-patterns-parse.js';
import {applyUpdate} from './setup-project/config.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

// One discovered candidate. `firstSeenInPull` is the first pull slug
// where the function appeared, used as a UI hint so the user can see
// where a name comes from. `occurrences` counts how many pulls export
// it (helps disambiguate when names overlap).
type Candidate = {
	name: string;
	firstSeenInPull: string;
	occurrences: number;
};

type Phase =
	| {kind: 'loading'; events: LogEvent[]}
	| {kind: 'picking'; candidates: Candidate[]}
	| {kind: 'message'; title: string; subtitle?: string}
	| {kind: 'saving'}
	| {kind: 'success'; saved: number}
	| {kind: 'error'; message: string};

export default function ExtractPatterns({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading', events: []});

	useEffect(() => {
		const controller = new AbortController();

		(async () => {
			const events: LogEvent[] = [];
			const emit = (ev: LogEvent) => {
				events.push(ev);
				if (!controller.signal.aborted) {
					setPhase({kind: 'loading', events: [...events]});
				}
			};

			try {
				const candidates = await discoverCandidates(activeProject.dir, emit);
				if (controller.signal.aborted) return;
				if (candidates.length === 0) {
					setPhase({
						kind: 'message',
						title: 'No pattern candidates found.',
						subtitle:
							'Pull a design with at least one non-default-export top-level function first.',
					});
					return;
				}
				setPhase({kind: 'picking', candidates});
			} catch (err) {
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'error',
					message: err instanceof Error ? err.message : String(err),
				});
			}
		})();

		return () => controller.abort();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useInput(
		() => {
			onDone();
		},
		{
			isActive:
				phase.kind === 'message' ||
				phase.kind === 'success' ||
				phase.kind === 'error',
		},
	);

	const submit = (selected: Candidate[]) => {
		setPhase({kind: 'saving'});
		(async () => {
			try {
				const names = selected.map(c => c.name);
				await applyUpdate(activeProject, {
					patterns: names.length > 0 ? names : undefined,
				});
				setPhase({kind: 'success', saved: names.length});
			} catch (err) {
				setPhase({
					kind: 'error',
					message: err instanceof Error ? err.message : String(err),
				});
			}
		})();
	};

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Extract patterns
				</Text>
				<Box marginTop={1}>
					<EventList events={phase.events} status="running" />
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Extract patterns
				</Text>
				<Box marginTop={1}>
					<Text color="yellow" bold>
						{phase.title}
					</Text>
				</Box>
				{phase.subtitle ? <Text dimColor>{phase.subtitle}</Text> : null}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'picking') {
		const initialSelected = new Set(activeProject.config.patterns ?? []);
		const items = phase.candidates.map(c => ({
			key: c.name,
			label: c.name,
			hint:
				c.occurrences > 1
					? `first seen in ${c.firstSeenInPull} (${c.occurrences} pulls)`
					: `from ${c.firstSeenInPull}`,
			value: c,
		}));
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Extract patterns
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>
						Found {phase.candidates.length} candidate
						{phase.candidates.length === 1 ? '' : 's'} across your design pulls.
						Toggle the patterns you want to keep and press Enter — your
						selection is saved to neptune-config and drives the Pull pattern
						picker. Names already saved are pre-checked.
					</Text>
				</Box>
				<Box marginTop={1}>
					<MultiSelect
						items={items}
						initialSelectedKeys={Array.from(initialSelected)}
						onSubmit={submit}
						onCancel={onDone}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'saving') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Extract patterns
				</Text>
				<Box marginTop={1}>
					<Text dimColor>Saving selection…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'success') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Extract patterns
				</Text>
				<Box marginTop={1}>
					<Text color="green" bold>
						✓ Saved {phase.saved} pattern name{phase.saved === 1 ? '' : 's'} to
						neptune-config.
					</Text>
				</Box>
				<Text dimColor>Pull each pattern from Figma via Pull pattern.</Text>
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">
				Extract patterns
			</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color="red" bold>
					✗ Extraction failed.
				</Text>
				<Text color="red">{phase.message}</Text>
				<Text dimColor>Press any key to return.</Text>
			</Box>
		</Box>
	);
}

async function discoverCandidates(
	projectDir: string,
	emit: (ev: LogEvent) => void,
): Promise<Candidate[]> {
	const pulls = await listPulls(projectDir);
	const regular = pulls.filter(p => p.special === undefined);

	if (regular.length === 0) {
		throw new Error(
			'No regular pulls found in design/ — pull a non-special template first.',
		);
	}

	emit({
		kind: 'step',
		message: `Scanning ${regular.length} pull${regular.length === 1 ? '' : 's'}…`,
	});

	const byName = new Map<string, Candidate>();

	for (const pull of regular) {
		const codePath = join(projectDir, 'design', pull.slug, 'code.tsx');
		let code: string;
		try {
			code = await readFile(codePath, 'utf8');
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				emit({kind: 'warn', message: `${pull.slug}: no code.tsx, skipping`});
				continue;
			}
			throw err;
		}

		const {defaultName, functions} = parseTopLevelFunctions(code);
		const patterns = functions.filter(f => f.name !== defaultName);

		if (patterns.length === 0) {
			emit({kind: 'step', message: `${pull.slug}: no patterns found`});
			continue;
		}

		for (const fn of patterns) {
			const existing = byName.get(fn.name);
			if (existing) {
				existing.occurrences += 1;
			} else {
				byName.set(fn.name, {
					name: fn.name,
					firstSeenInPull: pull.slug,
					occurrences: 1,
				});
			}
		}

		emit({
			kind: 'step',
			message: `${pull.slug}: ${patterns.length} candidate${patterns.length === 1 ? '' : 's'}`,
		});
	}

	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
