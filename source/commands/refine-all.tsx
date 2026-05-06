// Sequentially refines every pickable pull via the same runDiagnose +
// runApply path that refine-template uses. Auto-approves all visual-diff
// findings — the upfront warning makes that explicit, otherwise this
// would just be the manual flow with a different entry point.
//
// Per-pull failures (capture, diagnose, apply) don't abort the batch;
// they're tallied. Pulls that already match the design are recorded as
// "matched" and skipped.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../lib/menu.js';
import {AgentAbortedError} from '../lib/agent-stream.js';
import {listPulls, sortByTemplatePriority} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {runApply, runDiagnose} from './refine-template.js';
import type {Loaded} from './setup-project/types.js';
import type {PullMeta} from '../lib/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type PickablePull = PullMeta & {templateFile: string};

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
	| {kind: 'confirm'; pulls: PickablePull[]}
	| {kind: 'running'; pulls: PickablePull[]; cursor: number}
	| {kind: 'done'; outcomes: Outcome[]}
	| {kind: 'message'; title: string; subtitle?: string};

export default function RefineAll({activeProject, onDone}: Props) {
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
						title: 'No pulls available to refine.',
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
					const result = await runDiagnose(
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

					// Auto-approve every diff the visual-diff agent reported.
					const approved = result.report.diffs;
					if (approved.length === 0) {
						outcomesRef.current.push({
							kind: 'matched',
							slug: pull.slug,
							ratio: 0,
						});
						continue;
					}

					const applyResult = await runApply(
						activeProject,
						{
							pull,
							currentTemplate: result.currentTemplate,
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
				<Text bold color="cyan">Refine all templates</Text>
				<Box marginTop={1}>
					<Text dimColor>Loading pulls…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine all templates</Text>
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
			{
				key: 'proceed',
				label: 'Refine all and auto-apply every diff',
				value: 'proceed',
			},
		];
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine all templates</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" bold>
						This will refine {phase.pulls.length} template{phase.pulls.length === 1 ? '' : 's'}.
					</Text>
					<Text>
						For each, Neptune captures a screenshot, diffs against the design,
						and AUTO-APPLIES every visual difference the diff agent reports —
						no per-diff review. Existing template posts will be overwritten.
						Each refine is two paid Claude Agent SDK calls plus a browser
						capture.
					</Text>
					<Box marginTop={1}>
						<Text dimColor>
							Heads up: the visual-diff agent sometimes flags subpixel /
							anti-aliasing noise as a low-severity diff. Without per-diff
							review those get applied too. If that becomes a problem, refine
							individually via &quot;Refine template&quot; instead.
						</Text>
					</Box>
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
				<Text bold color="cyan">Refine all templates</Text>
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
			<Text bold color="cyan">Refine all templates</Text>
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
