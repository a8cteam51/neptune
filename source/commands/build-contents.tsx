// Build contents UI shell. Lists every usesPostContent pull, lets the
// user toggle the set they want, then sequentially calls runBuildContent
// from commands/build-content.ts on each. Every row starts checked so
// the common case (build everything) is one Enter; toggling off lets
// the user build a single page. No per-pull "overwrite?" prompt — the
// picker IS the confirmation. Per-pull failures don't abort the batch;
// they're tallied.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import MultiSelect from '../lib/multi-select.js';
import {AgentAbortedError} from '../lib/agent-stream.js';
import {listPulls, sortByTemplatePriority} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {runBuildContent, type ContentBuildPull} from './build-content.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Outcome =
	| {kind: 'ok'; slug: string; label: string; size: number}
	| {kind: 'err'; slug: string; error: string};

type Phase =
	| {kind: 'loading'}
	| {kind: 'picking'; pulls: ContentBuildPull[]}
	| {kind: 'running'; pulls: ContentBuildPull[]; cursor: number}
	| {kind: 'done'; outcomes: Outcome[]}
	| {kind: 'message'; title: string; subtitle?: string};

export default function BuildContents({activeProject, onDone}: Props) {
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
					(p): p is ContentBuildPull =>
						p.special === undefined &&
						p.usesPostContent === true &&
						typeof p.pageSlug === 'string' &&
						p.pageSlug.length > 0,
				);
				if (pickable.length === 0) {
					setPhase({
						kind: 'message',
						title: 'No content-bearing pulls available.',
						subtitle: 'Pull a template flagged as uses post_content first.',
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

	const beginRun = (pulls: ContentBuildPull[]) => {
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
						message: `[${i + 1}/${pulls.length}] ${pull.pageName} → page:${pull.pageSlug}`,
					},
				]);
				try {
					const result = await runBuildContent(
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
			if (phase.kind === 'message' || phase.kind === 'done') {
				onDone();
				return;
			}
			if (phase.kind === 'picking' && key.escape) onDone();
		},
		{
			isActive:
				phase.kind === 'message' ||
				phase.kind === 'done' ||
				phase.kind === 'picking',
		},
	);

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Build contents
				</Text>
				<Box marginTop={1}>
					<Text dimColor>Loading pulls…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Build contents
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
		const items = phase.pulls.map(p => ({
			key: p.slug,
			label: `${p.pageName} → page:${p.pageSlug}`,
			value: p,
		}));
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Build contents
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" bold>
						All {phase.pulls.length} page{phase.pulls.length === 1 ? '' : 's'}{' '}
						are selected by default.
					</Text>
					<Text>
						Toggle off any you don&apos;t want to build and press Enter.
						Existing page posts for the selected pulls will be overwritten
						(revision history is preserved). Each build is a paid agent provider
						call.
					</Text>
				</Box>
				<Box marginTop={1}>
					<MultiSelect
						items={items}
						onSubmit={selected => {
							if (selected.length === 0) {
								onDone();
								return;
							}
							beginRun(selected);
						}}
						onCancel={onDone}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'running') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Build contents
				</Text>
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
			<Text bold color="cyan">
				Build contents
			</Text>
			<Box marginTop={1}>
				<EventList
					events={events}
					status={failed === 0 ? 'success' : 'error'}
				/>
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
