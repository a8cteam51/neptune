// Human-only diff viewer. Same capture+odiff pipeline as Refine
// template, but stops at the diff image instead of feeding it to the
// visual-diff agent — no SDK call, no cost. Auto-opens diff.png in
// the platform's default image viewer.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../lib/menu.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {listPulls, sortByTemplatePriority} from '../lib/design-walk.js';
import {openFileInDefaultApp} from '../lib/open-file.js';
import {
	captureAndDiffPull,
	CaptureAbortedError,
	type DiffPull,
} from '../lib/template-diff.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Phase =
	| {kind: 'loading'}
	| {kind: 'picking'; pulls: DiffPull[]}
	| {kind: 'capturing'; pull: DiffPull}
	| {
			kind: 'matched';
			pull: DiffPull;
			ratio: number;
			designPath: string;
			livePath: string;
	  }
	| {
			kind: 'differs';
			pull: DiffPull;
			ratio: number;
			pixelCount: number;
			diffPath: string;
			designPath: string;
			livePath: string;
			openedDiff: boolean;
	  }
	| {kind: 'error'; error: string}
	| {kind: 'message'; title: string; subtitle?: string};

export default function ViewTemplateDiff({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [events, setEvents] = useState<LogEvent[]>([]);
	const runControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		(async () => {
			try {
				const pulls = await listPulls(activeProject.dir);
				if (controller.signal.aborted) return;
				const pickable = pulls.filter(
					(p): p is DiffPull =>
						p.special === undefined &&
						p.contentOnly !== true &&
						typeof p.templateFile === 'string' &&
						p.templateFile.length > 0,
				);
				if (pickable.length === 0) {
					setPhase({
						kind: 'message',
						title: 'No pulls available to diff.',
						subtitle:
							'Pull a non-special template with a templateFile first. Content-only pulls share their wrapper with another pull.',
					});
					return;
				}
				setPhase({
					kind: 'picking',
					pulls: sortByTemplatePriority(pickable),
				});
			} catch (err) {
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'message',
					title: 'Could not load pulls.',
					subtitle: err instanceof Error ? err.message : String(err),
				});
			}
		})();
		return () => controller.abort();
	}, [activeProject.dir]);

	useEffect(
		() => () => {
			runControllerRef.current?.abort();
		},
		[],
	);

	const beginCapture = (pull: DiffPull) => {
		setPhase({kind: 'capturing', pull});
		setEvents([]);
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			try {
				const result = await captureAndDiffPull(
					activeProject,
					pull,
					controller.signal,
					ev => {
						if (!controller.signal.aborted) {
							setEvents(prev => [...prev, ev]);
						}
					},
				);
				if (controller.signal.aborted) return;

				const {outcome, diffPath, designPath, livePath, sizeNote} = result;
				if (!outcome.ok) {
					throw new Error(
						`odiff failed: ${outcome.reason} ${outcome.file ?? ''}`,
					);
				}
				if (outcome.match) {
					setPhase({
						kind: 'matched',
						pull,
						ratio: 0,
						designPath,
						livePath,
					});
					return;
				}
				if (outcome.kind !== 'pixel-diff') {
					throw new Error(
						'Padded diff produced layout-diff — should be unreachable.',
					);
				}
				if (outcome.diffPercentage === 0 && !sizeNote) {
					setPhase({
						kind: 'matched',
						pull,
						ratio: 0,
						designPath,
						livePath,
					});
					return;
				}
				const opened = openFileInDefaultApp(diffPath);
				setPhase({
					kind: 'differs',
					pull,
					ratio: outcome.diffPercentage,
					pixelCount: outcome.diffCount,
					diffPath,
					designPath,
					livePath,
					openedDiff: opened,
				});
			} catch (err) {
				if (controller.signal.aborted) return;
				if (err instanceof CaptureAbortedError) return;
				setPhase({
					kind: 'error',
					error: err instanceof Error ? err.message : String(err),
				});
			}
		})();
	};

	useInput(
		(_input, key) => {
			if (
				phase.kind === 'message' ||
				phase.kind === 'matched' ||
				phase.kind === 'differs' ||
				phase.kind === 'error'
			) {
				onDone();
				return;
			}
			if (phase.kind === 'picking' && key.escape) onDone();
		},
		{
			isActive:
				phase.kind === 'message' ||
				phase.kind === 'matched' ||
				phase.kind === 'differs' ||
				phase.kind === 'error' ||
				phase.kind === 'picking',
		},
	);

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">View template diff</Text>
				<Text dimColor>Loading pulls…</Text>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">View template diff</Text>
				<Box marginTop={1}>
					<Text color="yellow" bold>{phase.title}</Text>
				</Box>
				{phase.subtitle ? <Text dimColor>{phase.subtitle}</Text> : null}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'picking') {
		const items = phase.pulls.map(p => ({
			key: p.slug,
			label: `${p.pageName} → ${p.templateFile}`,
			value: p,
		}));
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">View template diff</Text>
				<Box marginTop={1}>
					<Text bold>Pick a pull to diff:</Text>
				</Box>
				<Box marginTop={1}>
					<Menu items={items} onSelect={item => beginCapture(item.value)} />
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Esc to cancel.</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'matched') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">View template diff</Text>
				<Box marginTop={1}>
					<Text color="green" bold>
						✓ Live render matches the design (diff{' '}
						{phase.ratio.toFixed(2)}%).
					</Text>
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text dimColor>{phase.designPath}</Text>
					<Text dimColor>{phase.livePath}</Text>
				</Box>
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'differs') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">View template diff</Text>
				<Box marginTop={1}>
					<Text color="yellow" bold>
						● Live render differs from design ({phase.pixelCount} px,{' '}
						{phase.ratio.toFixed(2)}%).
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text>
						{phase.openedDiff
							? 'Opened diff.png in your default image viewer.'
							: 'Open diff.png to see where:'}
					</Text>
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text dimColor>{phase.diffPath}</Text>
					<Text dimColor>{phase.designPath}</Text>
					<Text dimColor>{phase.livePath}</Text>
				</Box>
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'error') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">View template diff</Text>
				<Box marginTop={1}>
					<EventList events={events} status="error" />
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>✗ Diff failed.</Text>
					<Text color="red">{phase.error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">View template diff</Text>
			<Box marginTop={1}>
				<EventList events={events} status="running" />
			</Box>
		</Box>
	);
}
