// Sequentially rebuilds every pickable pull's template via the same
// runBuild path that build-template uses. One up-front confirm gate;
// no per-template "overwrite?" prompt — the user already accepted that
// at the top. Failures don't abort the batch; they're tallied.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../lib/menu.js';
import {AgentAbortedError} from '../lib/agent-stream.js';
import {listPulls, sortByTemplatePriority} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {runBuild} from './build-template.js';
import type {Loaded} from './setup-project/types.js';
import type {PullMeta} from '../lib/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type PickablePull = PullMeta & {templateFile: string};

type Outcome =
	| {kind: 'ok'; slug: string; label: string; size: number}
	| {kind: 'err'; slug: string; error: string};

type Phase =
	| {kind: 'loading'}
	| {kind: 'confirm'; pulls: PickablePull[]}
	| {kind: 'running'; pulls: PickablePull[]; cursor: number}
	| {kind: 'done'; outcomes: Outcome[]}
	| {kind: 'message'; title: string; subtitle?: string};

export default function BuildAll({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [events, setEvents] = useState<LogEvent[]>([]);
	const outcomesRef = useRef<Outcome[]>([]);
	const runControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		(async () => {
			try {
				const pulls = await listPulls(activeProject.dir);
				if (controller.signal.aborted) return;
				const pickable = pulls.filter(
					(p): p is PickablePull =>
						p.special === undefined &&
						p.contentOnly !== true &&
						typeof p.templateFile === 'string' &&
						p.templateFile.length > 0,
				);
				if (pickable.length === 0) {
					setPhase({
						kind: 'message',
						title: 'No pulls available to build.',
						subtitle:
							'Pull a non-special template with a templateFile first.',
					});
					return;
				}
				setPhase({
					kind: 'confirm',
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

	const beginRun = (pulls: PickablePull[]) => {
		setPhase({kind: 'running', pulls, cursor: 0});
		setEvents([]);
		outcomesRef.current = [];
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			for (let i = 0; i < pulls.length; i++) {
				if (controller.signal.aborted) return;
				const pull = pulls[i]!;
				setPhase({kind: 'running', pulls, cursor: i});
				setEvents(prev => [
					...prev,
					{
						kind: 'step',
						message: `[${i + 1}/${pulls.length}] ${pull.pageName} → ${pull.templateFile}`,
					},
				]);
				try {
					const result = await runBuild(
						activeProject,
						pull,
						controller.signal,
						ev => {
							if (!controller.signal.aborted) {
								setEvents(prev => [...prev, ev]);
							}
						},
					);
					outcomesRef.current.push({
						kind: 'ok',
						slug: pull.slug,
						label: result.path,
						size: result.size,
					});
				} catch (err) {
					if (controller.signal.aborted) return;
					if (err instanceof AgentAbortedError) return;
					const msg = err instanceof Error ? err.message : String(err);
					outcomesRef.current.push({
						kind: 'err',
						slug: pull.slug,
						error: msg,
					});
					setEvents(prev => [
						...prev,
						{kind: 'warn', message: `Failed: ${msg}`},
					]);
				}
			}
			if (controller.signal.aborted) return;
			setPhase({kind: 'done', outcomes: outcomesRef.current.slice()});
		})();
	};

	useInput(
		(_input, key) => {
			if (
				phase.kind === 'message' ||
				phase.kind === 'done'
			) {
				onDone();
				return;
			}
			if (phase.kind === 'confirm' && key.escape) onDone();
		},
		{
			isActive:
				phase.kind === 'message' ||
				phase.kind === 'done' ||
				phase.kind === 'confirm',
		},
	);

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build all templates</Text>
				<Box marginTop={1}>
					<Text dimColor>Loading pulls…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build all templates</Text>
				<Box marginTop={1}>
					<Text color="yellow" bold>{phase.title}</Text>
				</Box>
				{phase.subtitle ? <Text dimColor>{phase.subtitle}</Text> : null}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'confirm') {
		const items = [
			{key: 'cancel', label: 'Cancel', value: 'cancel'},
			{key: 'proceed', label: 'Build all and overwrite', value: 'proceed'},
		];
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build all templates</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" bold>
						This will rebuild {phase.pulls.length} template{phase.pulls.length === 1 ? '' : 's'}.
					</Text>
					<Text>
						Every existing template post in the database will be overwritten
						(revision history is preserved). Each build is a paid Claude Agent
						SDK call.
					</Text>
				</Box>
				<Box marginTop={1} flexDirection="column">
					{phase.pulls.map(p => (
						<Text key={p.slug} dimColor>
							  {p.pageName} → {p.templateFile}
						</Text>
					))}
				</Box>
				<Box marginTop={1}>
					<Menu
						items={items}
						onSelect={item => {
							if (item.value === 'proceed') beginRun(phase.pulls);
							else onDone();
						}}
					/>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Esc to cancel.</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'running') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build all templates</Text>
				<Box marginTop={1}>
					<EventList events={events} status="running" />
				</Box>
			</Box>
		);
	}

	const ok = phase.outcomes.filter(o => o.kind === 'ok').length;
	const failed = phase.outcomes.filter(o => o.kind === 'err').length;
	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Build all templates</Text>
			<Box marginTop={1}>
				<EventList events={events} status={failed === 0 ? 'success' : 'error'} />
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text color={failed === 0 ? 'green' : 'yellow'} bold>
					{ok} succeeded, {failed} failed
				</Text>
				{phase.outcomes.map(o =>
					o.kind === 'ok' ? (
						<Text key={o.slug} color="green">
							  ✓ {o.slug} → {o.label} ({o.size} bytes)
						</Text>
					) : (
						<Text key={o.slug} color="red">
							  ✗ {o.slug}: {o.error}
						</Text>
					),
				)}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		</Box>
	);
}
