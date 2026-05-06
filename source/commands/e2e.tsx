// End-to-end orchestrator. Runs the full build/refine pipeline in
// the order the user requested:
//   1. Build theme.json.
//   2. Build all patterns (every selected pattern → PHP file in
//      <theme>/patterns/). theme.json is the first step because the
//      pattern build agent reads it as context.
//   3. Build all content (every usesPostContent pull → page post).
//   4. Build all templates (every non-special, non-contentOnly pull
//      → wp_template / wp_template_part).
//   5. Refine all content (capture, diff, auto-apply).
//   6. Refine all templates (capture, diff, auto-apply).
//
// Pre-reqs (enforced when the user enters the screen, not in the menu
// gate, so the user gets a precise reason if anything is missing):
//   - active project + themeSlug.
//   - at least one non-special pull on disk.
//   - every name in config.patterns has its source pulled to
//     patterns/<Name>/code.tsx (i.e. Pull pattern has run for
//     everything the user picked in Extract patterns). E2E builds
//     them; we don't ask the user to do that step manually.
//
// Token/USD totals: every runAgent call emits a structured `usage`
// LogEvent at the end. The orchestrator's event sink filters those out
// of the visible stream and accumulates the numbers; the summary at
// the end shows totals plus runtime.
//
// Per-pull failures don't abort the run — they're tallied. The user
// presses any key on the summary screen to return to the menu.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {AgentAbortedError} from '../lib/agent-stream.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {buildThemeJson} from './build-theme-json.js';
import {runBuild as runBuildTemplate} from './build-template.js';
import {runBuildContent} from './build-content.js';
import {runBuildPattern} from './build-pattern.js';
import {checkPrereqs, type Plan} from './e2e-prereqs.js';
import {runApply, runDiagnose} from './refine-template.js';
import {runApplyContent, runDiagnoseContent} from './refine-content.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Tally = {
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
	agentCalls: number;
};

type Failure = {slug: string; error: string};

type ThemeResult = {step: 'theme'; outcome: 'ok' | 'fail'; error?: string};
type BuildPatternsRes = {
	step: 'buildPatterns';
	ok: number;
	failed: number;
	failures: Failure[];
};
type BuildContentRes = {
	step: 'buildContent';
	ok: number;
	failed: number;
	failures: Failure[];
};
type BuildTemplatesRes = {
	step: 'buildTemplates';
	ok: number;
	failed: number;
	failures: Failure[];
};
type RefineContentRes = {
	step: 'refineContent';
	applied: number;
	matched: number;
	failed: number;
	failures: Failure[];
};
type RefineTemplatesRes = {
	step: 'refineTemplates';
	applied: number;
	matched: number;
	failed: number;
	failures: Failure[];
};

type StepResult =
	| ThemeResult
	| BuildPatternsRes
	| BuildContentRes
	| BuildTemplatesRes
	| RefineContentRes
	| RefineTemplatesRes;

type Phase =
	| {kind: 'loading'}
	| {kind: 'gated'; missing: string[]}
	| {kind: 'confirm'; plan: Plan}
	| {
			kind: 'running';
			plan: Plan;
			currentLabel: string;
			currentIndex: number;
			totalSteps: number;
			elapsedMs: number;
			tally: Tally;
			cancelling: boolean;
	  }
	| {
			kind: 'done';
			results: StepResult[];
			tally: Tally;
			elapsedMs: number;
			cancelled: boolean;
	  };

const FRESH_TALLY: Tally = {
	costUsd: 0,
	inputTokens: 0,
	outputTokens: 0,
	cacheReadInputTokens: 0,
	cacheCreationInputTokens: 0,
	agentCalls: 0,
};

export default function E2E({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [events, setEvents] = useState<LogEvent[]>([]);
	const runControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		(async () => {
			try {
				const gate = await checkPrereqs(activeProject);
				if (controller.signal.aborted) return;
				if (gate.missing.length > 0) {
					setPhase({kind: 'gated', missing: gate.missing});
					return;
				}
				setPhase({kind: 'confirm', plan: gate.plan});
			} catch (err) {
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'gated',
					missing: [
						err instanceof Error ? err.message : String(err),
					],
				});
			}
		})();
		return () => controller.abort();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(
		() => () => {
			runControllerRef.current?.abort();
		},
		[],
	);

	useInput(
		(_input, key) => {
			if (
				phase.kind === 'gated' ||
				phase.kind === 'done'
			) {
				onDone();
				return;
			}
			if (phase.kind === 'confirm') {
				if (key.return) {
					beginRun(phase.plan);
				} else if (key.escape) {
					onDone();
				}
				return;
			}
			if (phase.kind === 'running') {
				// Esc aborts the run controller. The IIFE catches the
				// resulting AgentAbortedError, sets a cancellation flag,
				// pushes whatever phase results have accumulated, and
				// transitions to phase: done. The user can then press any
				// key to return to the menu.
				if (key.escape && !phase.cancelling) {
					setPhase(prev =>
						prev.kind === 'running' ? {...prev, cancelling: true} : prev,
					);
					runControllerRef.current?.abort();
				}
			}
		},
		{
			isActive:
				phase.kind === 'gated' ||
				phase.kind === 'done' ||
				phase.kind === 'confirm' ||
				phase.kind === 'running',
		},
	);

	const beginRun = (plan: Plan) => {
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;

		const startedAt = Date.now();
		const tally: Tally = {...FRESH_TALLY};
		const results: StepResult[] = [];

		// Total step count = 1 (theme) + N pulls/sources across the
		// pattern + content + template + refine-content + refine-template
		// lists. Used purely for the "Step k of N" header label.
		const totalSteps =
			1 +
			plan.patternSources.length +
			plan.contentPulls.length +
			plan.templatePulls.length +
			plan.contentPulls.length +
			plan.templatePulls.length;

		setPhase({
			kind: 'running',
			plan,
			currentLabel: 'Phase 1/6: Build theme.json',
			currentIndex: 1,
			totalSteps,
			elapsedMs: 0,
			tally: {...tally},
			cancelling: false,
		});
		setEvents([]);

		// Re-render every second so the running clock advances even
		// while a long agent call is in flight. The clock interval is
		// cleared in the finally block below.
		const tickInterval = setInterval(() => {
			setPhase(prev =>
				prev.kind === 'running'
					? {...prev, elapsedMs: Date.now() - startedAt}
					: prev,
			);
		}, 1000);

		const sink = (label: string, index: number) => (ev: LogEvent) => {
			if (controller.signal.aborted) return;
			if (ev.kind === 'usage') {
				tally.agentCalls += 1;
				if (ev.costUsd !== undefined) tally.costUsd += ev.costUsd;
				if (ev.inputTokens !== undefined)
					tally.inputTokens += ev.inputTokens;
				if (ev.outputTokens !== undefined)
					tally.outputTokens += ev.outputTokens;
				if (ev.cacheReadInputTokens !== undefined)
					tally.cacheReadInputTokens += ev.cacheReadInputTokens;
				if (ev.cacheCreationInputTokens !== undefined)
					tally.cacheCreationInputTokens += ev.cacheCreationInputTokens;
			}
			setEvents(prev => [...prev, ev]);
			setPhase(prev =>
				prev.kind === 'running'
					? {
							...prev,
							currentLabel: label,
							currentIndex: index,
							elapsedMs: Date.now() - startedAt,
							tally: {...tally},
						}
					: prev,
			);
		};

		const updateLabel = (label: string, index: number) => {
			setPhase(prev =>
				prev.kind === 'running'
					? {...prev, currentLabel: label, currentIndex: index}
					: prev,
			);
		};

		(async () => {
			try {
				let stepIndex = 0;

				// Suppresses both AgentAbortedError and any other error
				// thrown after the user aborted the controller — the loop
				// header (`if (signal.aborted) break;`) handles unwinding,
				// so catch blocks just have to know "is this an abort?"
				// rather than rethrowing.
				const isAbort = (err: unknown): boolean =>
					controller.signal.aborted ||
					err instanceof AgentAbortedError;

				// Each phase pushes its (possibly partial) result before
				// the runLoop break check, so the done screen still shows
				// what work landed before the user pressed Esc.
				runLoop: {
					// ── Phase 1: theme.json ──────────────────────────
					stepIndex++;
					updateLabel('Phase 1/6: Build theme.json', stepIndex);
					setEvents(prev => [
						...prev,
						{kind: 'step', message: '── Build theme.json ──'},
					]);
					try {
						await buildThemeJson(
							activeProject,
							controller.signal,
							sink('Phase 1/6: Build theme.json', stepIndex),
						);
						if (!controller.signal.aborted) {
							results.push({step: 'theme', outcome: 'ok'});
						}
					} catch (err) {
						if (!isAbort(err)) {
							const msg = err instanceof Error ? err.message : String(err);
							results.push({step: 'theme', outcome: 'fail', error: msg});
							setEvents(prev => [
								...prev,
								{kind: 'warn', message: `theme.json failed: ${msg}`},
							]);
						}
					}
					if (controller.signal.aborted) break runLoop;

					// ── Phase 2: build patterns ──────────────────────
					const buildPatternsResult: BuildPatternsRes = {
						step: 'buildPatterns',
						ok: 0,
						failed: 0,
						failures: [],
					};
					setEvents(prev => [
						...prev,
						{kind: 'step', message: '── Build patterns ──'},
					]);
					for (let i = 0; i < plan.patternSources.length; i++) {
						if (controller.signal.aborted) break;
						stepIndex++;
						const src = plan.patternSources[i]!;
						const label = `Phase 2/6: Build patterns (${i + 1}/${plan.patternSources.length}) ${src.name}`;
						updateLabel(label, stepIndex);
						setEvents(prev => [
							...prev,
							{
								kind: 'step',
								message: `[pattern ${i + 1}/${plan.patternSources.length}] ${src.name}`,
							},
						]);
						try {
							await runBuildPattern(
								activeProject,
								src,
								controller.signal,
								sink(label, stepIndex),
							);
							buildPatternsResult.ok += 1;
						} catch (err) {
							if (isAbort(err)) break;
							const msg = err instanceof Error ? err.message : String(err);
							buildPatternsResult.failed += 1;
							buildPatternsResult.failures.push({
								slug: src.name,
								error: msg,
							});
							setEvents(prev => [
								...prev,
								{kind: 'warn', message: `${src.name} failed: ${msg}`},
							]);
						}
					}
					results.push(buildPatternsResult);
					if (controller.signal.aborted) break runLoop;

					// ── Phase 3: build content ───────────────────────
					const buildContentResult: BuildContentRes = {
						step: 'buildContent',
						ok: 0,
						failed: 0,
						failures: [],
					};
					setEvents(prev => [
						...prev,
						{kind: 'step', message: '── Build content ──'},
					]);
					for (let i = 0; i < plan.contentPulls.length; i++) {
						if (controller.signal.aborted) break;
						stepIndex++;
						const pull = plan.contentPulls[i]!;
						const label = `Phase 3/6: Build content (${i + 1}/${plan.contentPulls.length}) ${pull.pageName}`;
						updateLabel(label, stepIndex);
						setEvents(prev => [
							...prev,
							{
								kind: 'step',
								message: `[content ${i + 1}/${plan.contentPulls.length}] ${pull.pageName} → page:${pull.pageSlug}`,
							},
						]);
						try {
							await runBuildContent(
								activeProject,
								pull,
								controller.signal,
								sink(label, stepIndex),
							);
							buildContentResult.ok += 1;
						} catch (err) {
							if (isAbort(err)) break;
							const msg = err instanceof Error ? err.message : String(err);
							buildContentResult.failed += 1;
							buildContentResult.failures.push({
								slug: pull.slug,
								error: msg,
							});
							setEvents(prev => [
								...prev,
								{kind: 'warn', message: `${pull.slug} failed: ${msg}`},
							]);
						}
					}
					results.push(buildContentResult);
					if (controller.signal.aborted) break runLoop;

					// ── Phase 4: build templates ─────────────────────
					const buildTemplatesResult: BuildTemplatesRes = {
						step: 'buildTemplates',
						ok: 0,
						failed: 0,
						failures: [],
					};
					setEvents(prev => [
						...prev,
						{kind: 'step', message: '── Build templates ──'},
					]);
					for (let i = 0; i < plan.templatePulls.length; i++) {
						if (controller.signal.aborted) break;
						stepIndex++;
						const pull = plan.templatePulls[i]!;
						const label = `Phase 4/6: Build templates (${i + 1}/${plan.templatePulls.length}) ${pull.pageName}`;
						updateLabel(label, stepIndex);
						setEvents(prev => [
							...prev,
							{
								kind: 'step',
								message: `[template ${i + 1}/${plan.templatePulls.length}] ${pull.pageName} → ${pull.templateFile}`,
							},
						]);
						try {
							await runBuildTemplate(
								activeProject,
								pull,
								controller.signal,
								sink(label, stepIndex),
							);
							buildTemplatesResult.ok += 1;
						} catch (err) {
							if (isAbort(err)) break;
							const msg = err instanceof Error ? err.message : String(err);
							buildTemplatesResult.failed += 1;
							buildTemplatesResult.failures.push({
								slug: pull.slug,
								error: msg,
							});
							setEvents(prev => [
								...prev,
								{kind: 'warn', message: `${pull.slug} failed: ${msg}`},
							]);
						}
					}
					results.push(buildTemplatesResult);
					if (controller.signal.aborted) break runLoop;

					// ── Phase 5: refine content ──────────────────────
					const refineContentResult: RefineContentRes = {
						step: 'refineContent',
						applied: 0,
						matched: 0,
						failed: 0,
						failures: [],
					};
					setEvents(prev => [
						...prev,
						{kind: 'step', message: '── Refine content ──'},
					]);
					for (let i = 0; i < plan.contentPulls.length; i++) {
						if (controller.signal.aborted) break;
						stepIndex++;
						const pull = plan.contentPulls[i]!;
						const label = `Phase 5/6: Refine content (${i + 1}/${plan.contentPulls.length}) ${pull.pageName}`;
						updateLabel(label, stepIndex);
						setEvents(prev => [
							...prev,
							{
								kind: 'step',
								message: `[content refine ${i + 1}/${plan.contentPulls.length}] ${pull.pageName}`,
							},
						]);
						try {
							const diag = await runDiagnoseContent(
								activeProject,
								pull,
								controller.signal,
								sink(label, stepIndex),
							);
							if (controller.signal.aborted) break;
							if (diag.kind === 'matched') {
								refineContentResult.matched += 1;
								continue;
							}
							const approved = diag.report.diffs;
							if (approved.length === 0) {
								refineContentResult.matched += 1;
								continue;
							}
							await runApplyContent(
								activeProject,
								{
									pull,
									currentContent: diag.currentContent,
									target: diag.target,
									themeJsonText: diag.themeJsonText,
									variablesText: diag.variablesText,
									devAnnotationsText: diag.devAnnotationsText,
									existingVariationsText: diag.existingVariationsText,
								},
								approved,
								controller.signal,
								sink(label, stepIndex),
							);
							refineContentResult.applied += 1;
						} catch (err) {
							if (isAbort(err)) break;
							const msg = err instanceof Error ? err.message : String(err);
							refineContentResult.failed += 1;
							refineContentResult.failures.push({
								slug: pull.slug,
								error: msg,
							});
							setEvents(prev => [
								...prev,
								{kind: 'warn', message: `${pull.slug} failed: ${msg}`},
							]);
						}
					}
					results.push(refineContentResult);
					if (controller.signal.aborted) break runLoop;

					// ── Phase 6: refine templates ────────────────────
					const refineTemplatesResult: RefineTemplatesRes = {
						step: 'refineTemplates',
						applied: 0,
						matched: 0,
						failed: 0,
						failures: [],
					};
					setEvents(prev => [
						...prev,
						{kind: 'step', message: '── Refine templates ──'},
					]);
					for (let i = 0; i < plan.templatePulls.length; i++) {
						if (controller.signal.aborted) break;
						stepIndex++;
						const pull = plan.templatePulls[i]!;
						const label = `Phase 6/6: Refine templates (${i + 1}/${plan.templatePulls.length}) ${pull.pageName}`;
						updateLabel(label, stepIndex);
						setEvents(prev => [
							...prev,
							{
								kind: 'step',
								message: `[template refine ${i + 1}/${plan.templatePulls.length}] ${pull.pageName} → ${pull.templateFile}`,
							},
						]);
						try {
							const diag = await runDiagnose(
								activeProject,
								pull,
								controller.signal,
								sink(label, stepIndex),
							);
							if (controller.signal.aborted) break;
							if (diag.kind === 'matched') {
								refineTemplatesResult.matched += 1;
								continue;
							}
							const approved = diag.report.diffs;
							if (approved.length === 0) {
								refineTemplatesResult.matched += 1;
								continue;
							}
							await runApply(
								activeProject,
								{
									pull,
									currentTemplate: diag.currentTemplate,
									target: diag.target,
									themeJsonText: diag.themeJsonText,
									variablesText: diag.variablesText,
									devAnnotationsText: diag.devAnnotationsText,
									existingVariationsText: diag.existingVariationsText,
								},
								approved,
								controller.signal,
								sink(label, stepIndex),
							);
							refineTemplatesResult.applied += 1;
						} catch (err) {
							if (isAbort(err)) break;
							const msg = err instanceof Error ? err.message : String(err);
							refineTemplatesResult.failed += 1;
							refineTemplatesResult.failures.push({
								slug: pull.slug,
								error: msg,
							});
							setEvents(prev => [
								...prev,
								{kind: 'warn', message: `${pull.slug} failed: ${msg}`},
							]);
						}
					}
					results.push(refineTemplatesResult);
				}

				// Always reach the done phase, whether the runLoop
				// completed normally or was broken by an abort.
				setPhase({
					kind: 'done',
					results,
					tally: {...tally},
					elapsedMs: Date.now() - startedAt,
					cancelled: controller.signal.aborted,
				});
			} finally {
				clearInterval(tickInterval);
			}
		})();
	};

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">End-to-end build</Text>
				<Box marginTop={1}>
					<Text dimColor>Checking prerequisites…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'gated') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">End-to-end build</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" bold>
						Cannot run end-to-end yet. Missing:
					</Text>
					{phase.missing.map((m, i) => (
						<Text key={i} color="yellow">
							{'  · '}
							{m}
						</Text>
					))}
				</Box>
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'confirm') {
		const p = phase.plan.patternSources.length;
		const c = phase.plan.contentPulls.length;
		const t = phase.plan.templatePulls.length;
		const agentCalls = 1 + p + c + t + c * 2 + t * 2;
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">End-to-end build</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>
						The full pipeline will run in this order:
					</Text>
					<Text>
						{'  1. Build theme.json'}
					</Text>
					<Text>
						{`  2. Build patterns for ${p} pattern${p === 1 ? '' : 's'}`}
					</Text>
					<Text>
						{`  3. Build content for ${c} page${c === 1 ? '' : 's'}`}
					</Text>
					<Text>
						{`  4. Build templates for ${t} template${t === 1 ? '' : 's'}`}
					</Text>
					<Text>
						{`  5. Refine content for ${c} page${c === 1 ? '' : 's'} (auto-apply every diff)`}
					</Text>
					<Text>
						{`  6. Refine templates for ${t} template${t === 1 ? '' : 's'} (auto-apply every diff)`}
					</Text>
					<Box marginTop={1}>
						<Text color="yellow" bold>
							Up to {agentCalls} paid Claude Agent SDK call{agentCalls === 1 ? '' : 's'}.
						</Text>
					</Box>
					<Text dimColor>
						Existing theme.json, patterns, templates and page posts will be overwritten. Diffs are auto-approved — no per-diff review. Per-pull failures are tallied, not fatal.
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text bold>Press Enter to start. Esc to cancel.</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'running') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">End-to-end build</Text>
				<Box marginTop={1} flexDirection="column">
					<Text bold>{phase.currentLabel}</Text>
					<Text dimColor>
						Step {phase.currentIndex} / {phase.totalSteps} ·{' '}
						{formatElapsed(phase.elapsedMs)} elapsed · agent calls:{' '}
						{phase.tally.agentCalls} · cost: ${phase.tally.costUsd.toFixed(4)}
					</Text>
					{phase.cancelling ? (
						<Text color="yellow" bold>
							Cancelling — waiting for the in-flight step to unwind…
						</Text>
					) : (
						<Text dimColor>Press Esc to cancel.</Text>
					)}
				</Box>
				<Box marginTop={1}>
					<EventList events={events} status="running" />
				</Box>
			</Box>
		);
	}

	const themeResult = phase.results.find(
		(r): r is ThemeResult => r.step === 'theme',
	);
	const buildPatternsRes = phase.results.find(
		(r): r is BuildPatternsRes => r.step === 'buildPatterns',
	);
	const buildContentRes = phase.results.find(
		(r): r is BuildContentRes => r.step === 'buildContent',
	);
	const buildTemplatesRes = phase.results.find(
		(r): r is BuildTemplatesRes => r.step === 'buildTemplates',
	);
	const refineContentRes = phase.results.find(
		(r): r is RefineContentRes => r.step === 'refineContent',
	);
	const refineTemplatesRes = phase.results.find(
		(r): r is RefineTemplatesRes => r.step === 'refineTemplates',
	);
	const allFailures: Array<{phase: string; slug: string; error: string}> = [];
	if (themeResult?.outcome === 'fail') {
		allFailures.push({
			phase: 'theme.json',
			slug: '-',
			error: themeResult.error ?? 'unknown',
		});
	}
	for (const f of buildPatternsRes?.failures ?? []) {
		allFailures.push({phase: 'build patterns', ...f});
	}
	for (const f of buildContentRes?.failures ?? []) {
		allFailures.push({phase: 'build content', ...f});
	}
	for (const f of buildTemplatesRes?.failures ?? []) {
		allFailures.push({phase: 'build templates', ...f});
	}
	for (const f of refineContentRes?.failures ?? []) {
		allFailures.push({phase: 'refine content', ...f});
	}
	for (const f of refineTemplatesRes?.failures ?? []) {
		allFailures.push({phase: 'refine templates', ...f});
	}
	const anyFailures = allFailures.length > 0;
	const headlineColor = phase.cancelled
		? 'yellow'
		: anyFailures
			? 'yellow'
			: 'green';
	const headline = phase.cancelled
		? '● Cancelled — partial results below.'
		: anyFailures
			? '● Completed with issues.'
			: '✓ Completed.';
	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">End-to-end build</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color={headlineColor} bold>
					{headline}
				</Text>
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text bold>Phases</Text>
				{themeResult ? (
					<Text
						color={themeResult.outcome === 'ok' ? 'green' : 'red'}
					>
						{`  ${themeResult.outcome === 'ok' ? '✓' : '✗'} theme.json${
							themeResult.outcome === 'fail'
								? ` — ${themeResult.error ?? 'unknown'}`
								: ''
						}`}
					</Text>
				) : null}
				{buildPatternsRes ? (
					<Text>
						{`  · build patterns: ${buildPatternsRes.ok} ok, ${buildPatternsRes.failed} failed`}
					</Text>
				) : null}
				{buildContentRes ? (
					<Text>
						{`  · build content: ${buildContentRes.ok} ok, ${buildContentRes.failed} failed`}
					</Text>
				) : null}
				{buildTemplatesRes ? (
					<Text>
						{`  · build templates: ${buildTemplatesRes.ok} ok, ${buildTemplatesRes.failed} failed`}
					</Text>
				) : null}
				{refineContentRes ? (
					<Text>
						{`  · refine content: ${refineContentRes.applied} applied, ${refineContentRes.matched} matched, ${refineContentRes.failed} failed`}
					</Text>
				) : null}
				{refineTemplatesRes ? (
					<Text>
						{`  · refine templates: ${refineTemplatesRes.applied} applied, ${refineTemplatesRes.matched} matched, ${refineTemplatesRes.failed} failed`}
					</Text>
				) : null}
			</Box>
			{allFailures.length > 0 ? (
				<Box marginTop={1} flexDirection="column">
					<Text bold>Failures</Text>
					{allFailures.map((f, i) => (
						<Text key={i} color="red">
							{`  ✗ [${f.phase}] ${f.slug}: ${f.error}`}
						</Text>
					))}
				</Box>
			) : null}
			<Box marginTop={1} flexDirection="column">
				<Text bold>Tokens</Text>
				<Text>
					{`  input:           ${phase.tally.inputTokens.toLocaleString()}`}
				</Text>
				<Text>
					{`  output:          ${phase.tally.outputTokens.toLocaleString()}`}
				</Text>
				<Text>
					{`  cache read:      ${phase.tally.cacheReadInputTokens.toLocaleString()}`}
				</Text>
				<Text>
					{`  cache creation:  ${phase.tally.cacheCreationInputTokens.toLocaleString()}`}
				</Text>
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text bold>
					Total cost: ${phase.tally.costUsd.toFixed(4)}
				</Text>
				<Text>
					Agent calls: {phase.tally.agentCalls}
				</Text>
				<Text>
					Runtime: {formatElapsed(phase.elapsedMs)}
				</Text>
				{anyFailures || phase.cancelled ? (
					<Text dimColor>
						Note: token + cost totals can undercount when an agent call
						fails or is cancelled — the SDK doesn&apos;t always report
						usage on non-success results.
					</Text>
				) : null}
			</Box>
			<Box marginTop={1}>
				<Text dimColor>Press any key to return.</Text>
			</Box>
		</Box>
	);
}

function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}
