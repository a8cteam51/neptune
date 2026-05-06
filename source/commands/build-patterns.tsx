// Build patterns UI shell. Lists every patterns/<Name>/ source whose
// name appears in config.patterns (the user's selection from Extract
// patterns), lets them toggle the subset they want, then sequentially
// calls runBuildPattern from commands/build-pattern.ts on each. Every
// row starts checked so the common case (rebuild everything) is one
// Enter; toggling off lets the user rebuild a single pattern. No
// per-pattern confirm — the picker IS the confirmation. Per-pattern
// failures don't abort the batch; they're tallied.
//
// Filtering by config.patterns means the menu and E2E share the same
// source-of-truth: a pattern is buildable iff the user explicitly
// picked it. Folders left over on disk for an unselected pattern are
// invisible here until re-selected via Extract patterns.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {AgentAbortedError} from '../lib/agent-stream.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import MultiSelect from '../lib/multi-select.js';
import {
	kebabFromPascalCase,
	listPatternSources,
	type PatternSource,
} from '../lib/patterns.js';
import {runBuildPattern} from './build-pattern.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Outcome =
	| {kind: 'ok'; name: string; slug: string; path: string; size: number}
	| {kind: 'err'; name: string; error: string};

type Phase =
	| {kind: 'loading'}
	| {kind: 'picking'; sources: PatternSource[]}
	| {kind: 'running'; sources: PatternSource[]; cursor: number}
	| {kind: 'done'; outcomes: Outcome[]}
	| {kind: 'message'; title: string; subtitle?: string};

export default function BuildPatterns({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [events, setEvents] = useState<LogEvent[]>([]);
	const outcomesRef = useRef<Outcome[]>([]);
	const runControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		(async () => {
			try {
				if (!activeProject.config.themeSlug) {
					setPhase({
						kind: 'message',
						title: 'themeSlug missing from neptune-config.json.',
						subtitle: 'Finish theme setup first.',
					});
					return;
				}
				const allSources = await listPatternSources(activeProject.dir);
				if (controller.signal.aborted) return;
				const selected = new Set(activeProject.config.patterns ?? []);
				const sources =
					selected.size === 0
						? []
						: allSources.filter(s => selected.has(s.name));
				if (sources.length === 0) {
					setPhase({
						kind: 'message',
						title:
							selected.size === 0
								? 'No patterns selected.'
								: 'No pulled pattern sources match your selection.',
						subtitle:
							'Run Extract patterns to pick the names you care about, then Pull pattern to fetch each one from Figma.',
					});
					return;
				}
				setPhase({kind: 'picking', sources});
			} catch (err) {
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'message',
					title: 'Could not load pattern sources.',
					subtitle: err instanceof Error ? err.message : String(err),
				});
			}
		})();
		return () => controller.abort();
	}, [
		activeProject.config.themeSlug,
		activeProject.config.patterns,
		activeProject.dir,
	]);

	useEffect(
		() => () => {
			runControllerRef.current?.abort();
		},
		[],
	);

	const beginRun = (sources: PatternSource[]) => {
		setPhase({kind: 'running', sources, cursor: 0});
		setEvents([]);
		outcomesRef.current = [];
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			for (let i = 0; i < sources.length; i++) {
				if (controller.signal.aborted) return;
				const src = sources[i]!;
				setPhase({kind: 'running', sources, cursor: i});
				setEvents(prev => [
					...prev,
					{
						kind: 'step',
						message: `[${i + 1}/${sources.length}] ${src.name}`,
					},
				]);
				try {
					const result = await runBuildPattern(
						activeProject,
						src,
						controller.signal,
						ev => {
							if (!controller.signal.aborted) {
								setEvents(prev => [...prev, ev]);
							}
						},
					);
					outcomesRef.current.push({
						kind: 'ok',
						name: src.name,
						slug: result.slug,
						path: result.path,
						size: result.size,
					});
				} catch (err) {
					if (controller.signal.aborted) return;
					if (err instanceof AgentAbortedError) return;
					const msg = err instanceof Error ? err.message : String(err);
					outcomesRef.current.push({
						kind: 'err',
						name: src.name,
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
				<Text bold color="cyan">Build patterns</Text>
				<Box marginTop={1}>
					<Text dimColor>Loading patterns…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build patterns</Text>
				<Box marginTop={1}>
					<Text color="yellow" bold>{phase.title}</Text>
				</Box>
				{phase.subtitle ? <Text dimColor>{phase.subtitle}</Text> : null}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'picking') {
		const items = phase.sources.map(s => ({
			key: s.name,
			label: `${s.name} → <theme>/patterns/${kebabFromPascalCase(s.name)}.php`,
			value: s,
		}));
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build patterns</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" bold>
						All {phase.sources.length} pattern{phase.sources.length === 1 ? '' : 's'} are selected by default.
					</Text>
					<Text>
						Toggle off any you don&apos;t want to build and press Enter. Each
						selected pattern is one paid Claude Agent SDK call. Existing
						pattern PHP files at the same slug will be overwritten.
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
				<Text bold color="cyan">Build patterns</Text>
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
			<Text bold color="cyan">Build patterns</Text>
			<Box marginTop={1}>
				<EventList events={events} status={failed === 0 ? 'success' : 'error'} />
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text color={failed === 0 ? 'green' : 'yellow'} bold>
					{ok} succeeded, {failed} failed
				</Text>
				{phase.outcomes.map(o =>
					o.kind === 'ok' ? (
						<Text key={o.name} color="green">
							  ✓ {o.name} → {o.slug}.php ({o.size} bytes)
						</Text>
					) : (
						<Text key={o.name} color="red">
							  ✗ {o.name}: {o.error}
						</Text>
					),
				)}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		</Box>
	);
}
