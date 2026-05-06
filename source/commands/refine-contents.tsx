// Refine contents UI shell. Lists every pickable usesPostContent pull,
// lets the user toggle the set they want, then sequentially calls
// runDiagnoseContent + runApplyContent (from commands/refine-content.ts)
// on each. Mirrors refine-templates.tsx but targets page posts. Every
// row starts checked so the common case (refine everything) is one
// Enter; toggling off lets the user refine a single page. Auto-approves
// all visual-diff findings — the picker IS the confirmation. Per-pull
// failures don't abort the batch; they're tallied. Pages that already
// match the design are recorded as "matched" and skipped.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import MultiSelect from '../lib/multi-select.js';
import {AgentAbortedError} from '../lib/agent-stream.js';
import {listPulls, sortByTemplatePriority} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {
	runApplyContent,
	runDiagnoseContent,
	type ContentPull,
} from './refine-content.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Outcome =
	| {kind: 'matched'; slug: string; ratio: number}
	| {
			kind: 'applied';
			slug: string;
			label: string;
			applied: number;
			skipped: number;
	  }
	| {kind: 'err'; slug: string; error: string};

type Phase =
	| {kind: 'loading'}
	| {kind: 'picking'; pulls: ContentPull[]}
	| {kind: 'running'; pulls: ContentPull[]; cursor: number}
	| {kind: 'done'; outcomes: Outcome[]}
	| {kind: 'message'; title: string; subtitle?: string};

export default function RefineContents({activeProject, onDone}: Props) {
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
					(p): p is ContentPull =>
						p.special === undefined &&
						p.usesPostContent === true &&
						typeof p.pageSlug === 'string' &&
						p.pageSlug.length > 0 &&
						typeof p.templateFile === 'string' &&
						p.templateFile.length > 0,
				);
				if (pickable.length === 0) {
					setPhase({
						kind: 'message',
						title: 'No content-bearing pulls available.',
						subtitle:
							'Pull a template flagged as uses post_content first.',
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

	const beginRun = (pulls: ContentPull[]) => {
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
					const result = await runDiagnoseContent(
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
					if (result.kind === 'matched') {
						outcomesRef.current.push({
							kind: 'matched',
							slug: pull.slug,
							ratio: result.ratio,
						});
						continue;
					}

					const approved = result.report.diffs;
					if (approved.length === 0) {
						outcomesRef.current.push({
							kind: 'matched',
							slug: pull.slug,
							ratio: 0,
						});
						continue;
					}

					const applyResult = await runApplyContent(
						activeProject,
						{
							pull,
							currentContent: result.currentContent,
							target: result.target,
							themeJsonText: result.themeJsonText,
							variablesText: result.variablesText,
							devAnnotationsText: result.devAnnotationsText,
							existingVariationsText: result.existingVariationsText,
						},
						approved,
						controller.signal,
						ev => {
							if (!controller.signal.aborted) {
								setEvents(prev => [...prev, ev]);
							}
						},
					);
					if (controller.signal.aborted) return;
					outcomesRef.current.push({
						kind: 'applied',
						slug: pull.slug,
						label: applyResult.path,
						applied: applyResult.applied.length,
						skipped: applyResult.skipped.length,
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
				<Text bold color="cyan">Refine contents</Text>
				<Box marginTop={1}>
					<Text dimColor>Loading pulls…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine contents</Text>
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
			label: `${p.pageName} → page:${p.pageSlug}`,
			value: p,
		}));
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine contents</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" bold>
						All {phase.pulls.length} page{phase.pulls.length === 1 ? '' : 's'} are selected by default.
					</Text>
					<Text>
						Toggle off any you don&apos;t want to refine and press Enter. For each
						selected page, Neptune captures a screenshot, diffs against the
						design, and AUTO-APPLIES every visual difference the diff agent
						reports — no per-diff review. The diff agent is scoped to the
						page body only; wrapper chrome (header, footer, post-title) is
						refined via Refine templates. Existing page content will be
						overwritten. Each refine is two paid Claude Agent SDK calls plus
						a browser capture.
					</Text>
					<Box marginTop={1}>
						<Text dimColor>
							Heads up: the visual-diff agent sometimes flags subpixel /
							anti-aliasing noise as a low-severity diff. Without per-diff
							review those get applied too.
						</Text>
					</Box>
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
				<Text bold color="cyan">Refine contents</Text>
				<Box marginTop={1}>
					<EventList events={events} status="running" />
				</Box>
			</Box>
		);
	}

	const failed = phase.outcomes.filter(o => o.kind === 'err').length;
	const matched = phase.outcomes.filter(o => o.kind === 'matched').length;
	const applied = phase.outcomes.filter(o => o.kind === 'applied').length;
	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Refine contents</Text>
			<Box marginTop={1}>
				<EventList
					events={events}
					status={failed === 0 ? 'success' : 'error'}
				/>
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text color={failed === 0 ? 'green' : 'yellow'} bold>
					{applied} refined, {matched} already matched, {failed} failed
				</Text>
				{phase.outcomes.map(o => {
					if (o.kind === 'matched') {
						return (
							<Text key={o.slug} color="green">
								  ✓ {o.slug}: matched ({o.ratio.toFixed(2)}%)
							</Text>
						);
					}
					if (o.kind === 'applied') {
						return (
							<Text key={o.slug} color="green">
								  ✓ {o.slug} → {o.label} (applied {o.applied}, skipped{' '}
								{o.skipped})
							</Text>
						);
					}
					return (
						<Text key={o.slug} color="red">
							  ✗ {o.slug}: {o.error}
						</Text>
					);
				})}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		</Box>
	);
}
