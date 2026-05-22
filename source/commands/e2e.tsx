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
import {resolve} from 'node:path';
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {AgentAbortedError} from '../lib/agent-stream.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import MultiSelect from '../lib/multi-select.js';
import TextStep from '../lib/text-step.js';
import {inspectLayoutWidths} from '../lib/theme-json-patch.js';
import {
	buildThemeJson,
	readExistingLayoutWidths,
	validateLayoutLength,
	type LayoutWidths,
} from './build-theme-json.js';
import {runBuild as runBuildTemplate} from './build-template.js';
import {runBuildContent} from './build-content.js';
import {runBuildPattern} from './build-pattern.js';
import {checkPrereqs, type Plan} from './e2e-prereqs.js';
import {runApply, runDiagnose} from './refine-template.js';
import {runApplyContent, runDiagnoseContent} from './refine-content.js';
import type {Loaded} from './setup-project/types.js';

type PhaseKey =
	| 'theme'
	| 'buildPatterns'
	| 'buildContent'
	| 'buildTemplates'
	| 'refineContent'
	| 'refineTemplates';

const PHASE_ORDER: readonly PhaseKey[] = [
	'theme',
	'buildPatterns',
	'buildContent',
	'buildTemplates',
	'refineContent',
	'refineTemplates',
];

const PHASE_TITLES: Record<PhaseKey, string> = {
	theme: 'Build theme.json',
	buildPatterns: 'Build patterns',
	buildContent: 'Build content',
	buildTemplates: 'Build templates',
	refineContent: 'Refine content',
	refineTemplates: 'Refine templates',
};

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
	| {kind: 'confirm'; plan: Plan; widthDefaults: LayoutWidths}
	| {
			kind: 'widthsContent';
			plan: Plan;
			selected: ReadonlySet<PhaseKey>;
			defaults: LayoutWidths;
	  }
	| {
			kind: 'widthsWide';
			plan: Plan;
			selected: ReadonlySet<PhaseKey>;
			contentSize: string;
			defaults: LayoutWidths;
	  }
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
	// Holds the run between Phase 1 (theme.json) and Phase 2 (patterns)
	// so the user can drop font files into <theme>/assets/fonts/
	// (theme.json registers them but the build doesn't deliver the
	// .woff2 binaries — only the user has those). Enter resumes; Esc
	// cancels the run. Same shape as `running` so the surrounding UI
	// (clock, tally, step counter) keeps rendering coherently.
	| {
			kind: 'paused';
			plan: Plan;
			waitingFor: 'fonts';
			currentLabel: string;
			currentIndex: number;
			totalSteps: number;
			elapsedMs: number;
			tally: Tally;
			// Mirrors the post-build inspectLayoutWidths check. Surfaced
			// in the paused UI so the user fills these in alongside the
			// font binaries, before patterns/content/templates start
			// resolving align widths against an empty theme.json.
			contentSizeMissing: boolean;
			wideSizeMissing: boolean;
	  }
	| {
			kind: 'done';
			results: StepResult[];
			skipped: PhaseKey[];
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
	// Set while the orchestrator is awaiting the font-install gate. Enter
	// in `paused` calls resolve(); Esc aborts the run controller, which
	// rejects the awaited promise via its abort listener.
	const resumeRef = useRef<{
		resolve: () => void;
		reject: (err: Error) => void;
	} | null>(null);

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
				const themeSlug = activeProject.config.themeSlug;
				const widthDefaults = themeSlug
					? await readExistingLayoutWidths(
							resolve(
								activeProject.dir,
								'wordpress',
								'wp-content',
								'themes',
								themeSlug,
								'theme.json',
							),
						)
					: {contentSize: '', wideSize: ''};
				if (controller.signal.aborted) return;
				setPhase({kind: 'confirm', plan: gate.plan, widthDefaults});
			} catch (err) {
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'gated',
					missing: [err instanceof Error ? err.message : String(err)],
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
			if (phase.kind === 'gated' || phase.kind === 'done') {
				onDone();
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
			if (phase.kind === 'paused') {
				if (key.return) {
					const r = resumeRef.current;
					resumeRef.current = null;
					r?.resolve();
				} else if (key.escape) {
					resumeRef.current = null;
					runControllerRef.current?.abort();
				}
			}
		},
		{
			isActive:
				phase.kind === 'gated' ||
				phase.kind === 'done' ||
				phase.kind === 'running' ||
				phase.kind === 'paused',
		},
	);

	const beginRun = (
		plan: Plan,
		selected: ReadonlySet<PhaseKey>,
		widths: LayoutWidths,
	) => {
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;

		const startedAt = Date.now();
		const tally: Tally = {...FRESH_TALLY};
		const results: StepResult[] = [];

		// Renumber phase labels dynamically — the user sees "Phase k/N"
		// where N is the count of *selected* phases, not the canonical
		// six. The skipped set is preserved for the summary so the user
		// can see which phases they opted out of.
		const phasesToRun = PHASE_ORDER.filter(p => selected.has(p));
		const skipped = PHASE_ORDER.filter(p => !selected.has(p));
		const totalPhases = phasesToRun.length;
		const phaseIndex = (key: PhaseKey) => phasesToRun.indexOf(key) + 1;
		const phaseLabel = (key: PhaseKey, suffix = ''): string =>
			`Phase ${phaseIndex(key)}/${totalPhases}: ${PHASE_TITLES[key]}${suffix}`;

		// Total step count = sum across the selected phases. Theme.json
		// counts as 1 step; each per-pull phase counts its list length.
		const totalSteps =
			(selected.has('theme') ? 1 : 0) +
			(selected.has('buildPatterns') ? plan.patternSources.length : 0) +
			(selected.has('buildContent') ? plan.contentPulls.length : 0) +
			(selected.has('buildTemplates') ? plan.templatePulls.length : 0) +
			(selected.has('refineContent') ? plan.contentPulls.length : 0) +
			(selected.has('refineTemplates') ? plan.templatePulls.length : 0);

		const initialLabel = phasesToRun[0]
			? phaseLabel(phasesToRun[0])
			: 'Nothing to run';
		setPhase({
			kind: 'running',
			plan,
			currentLabel: initialLabel,
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
				if (ev.inputTokens !== undefined) tally.inputTokens += ev.inputTokens;
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
					controller.signal.aborted || err instanceof AgentAbortedError;

				// Each phase pushes its (possibly partial) result before
				// the runLoop break check, so the done screen still shows
				// what work landed before the user pressed Esc.
				runLoop: {
					// ── Phase 1: theme.json ──────────────────────────
					let themeOk = false;
					if (selected.has('theme')) {
						stepIndex++;
						updateLabel(phaseLabel('theme'), stepIndex);
						setEvents(prev => [
							...prev,
							{kind: 'step', message: '── Build theme.json ──'},
						]);
						try {
							await buildThemeJson(
								activeProject,
								widths,
								controller.signal,
								sink(phaseLabel('theme'), stepIndex),
							);
							if (!controller.signal.aborted) {
								results.push({step: 'theme', outcome: 'ok'});
								themeOk = true;
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
					}

					// ── Pause: install fonts ─────────────────────────
					// theme.json declares font-family entries that point at
					// <theme>/assets/fonts/<family>/<weight-style>.woff2 — the
					// build registers them but doesn't deliver the binaries.
					// Hold the run here so the user can drop their files in
					// before Phase 2 starts capturing pages whose patterns
					// depend on the registered families.
					//
					// Only pause when theme.json was both selected AND
					// succeeded: skipping the pause when theme.json was
					// skipped avoids prompting for fonts the user isn't
					// changing, and skipping after a failure avoids
					// confusing the recovery flow.
					if (themeOk) {
						setEvents(prev => [
							...prev,
							{
								kind: 'step',
								message:
									'── Paused: install fonts in <theme>/assets/fonts/, then press Enter ──',
							},
						]);
						const themeSlug = activeProject.config.themeSlug;
						let widthsStatus = {
							contentSizeMissing: false,
							wideSizeMissing: false,
						};
						if (themeSlug) {
							try {
								widthsStatus = await inspectLayoutWidths(
									resolve(
										activeProject.dir,
										'wordpress',
										'wp-content',
										'themes',
										themeSlug,
										'theme.json',
									),
								);
							} catch {
								// Best-effort — pause UI still renders without
								// the layout-widths hint if the read fails.
							}
						}
						setPhase(prev =>
							prev.kind === 'running'
								? {
										kind: 'paused',
										plan: prev.plan,
										waitingFor: 'fonts',
										currentLabel:
											'Paused — install fonts, then press Enter to continue',
										currentIndex: prev.currentIndex,
										totalSteps: prev.totalSteps,
										elapsedMs: prev.elapsedMs,
										tally: prev.tally,
										contentSizeMissing: widthsStatus.contentSizeMissing,
										wideSizeMissing: widthsStatus.wideSizeMissing,
									}
								: prev,
						);
						try {
							await new Promise<void>((resolve, reject) => {
								if (controller.signal.aborted) {
									reject(new AgentAbortedError());
									return;
								}
								resumeRef.current = {resolve, reject};
								const onAbort = () => {
									resumeRef.current = null;
									reject(new AgentAbortedError());
								};
								controller.signal.addEventListener('abort', onAbort, {
									once: true,
								});
							});
						} catch (err) {
							if (!isAbort(err)) throw err;
						}
						if (controller.signal.aborted) break runLoop;
						const nextAfterTheme = phasesToRun[1];
						setPhase(prev =>
							prev.kind === 'paused'
								? {
										kind: 'running',
										plan: prev.plan,
										currentLabel: nextAfterTheme
											? phaseLabel(nextAfterTheme)
											: 'Wrapping up…',
										currentIndex: prev.currentIndex,
										totalSteps: prev.totalSteps,
										elapsedMs: Date.now() - startedAt,
										tally: prev.tally,
										cancelling: false,
									}
								: prev,
						);
					}

					// ── Phase 2: build patterns ──────────────────────
					if (selected.has('buildPatterns')) {
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
							const label = `${phaseLabel('buildPatterns')} (${i + 1}/${plan.patternSources.length}) ${src.name}`;
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
					}

					// ── Phase 3: build content ───────────────────────
					if (selected.has('buildContent')) {
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
							const label = `${phaseLabel('buildContent')} (${i + 1}/${plan.contentPulls.length}) ${pull.pageName}`;
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
					}

					// ── Phase 4: build templates ─────────────────────
					if (selected.has('buildTemplates')) {
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
							const label = `${phaseLabel('buildTemplates')} (${i + 1}/${plan.templatePulls.length}) ${pull.pageName}`;
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
					}

					// ── Phase 5: refine content ──────────────────────
					if (selected.has('refineContent')) {
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
							const label = `${phaseLabel('refineContent')} (${i + 1}/${plan.contentPulls.length}) ${pull.pageName}`;
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
					}

					// ── Phase 6: refine templates ────────────────────
					if (selected.has('refineTemplates')) {
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
							const label = `${phaseLabel('refineTemplates')} (${i + 1}/${plan.templatePulls.length}) ${pull.pageName}`;
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
				}

				// Always reach the done phase, whether the runLoop
				// completed normally or was broken by an abort.
				setPhase({
					kind: 'done',
					results,
					skipped,
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
				<Text bold color="cyan">
					End-to-end build
				</Text>
				<Box marginTop={1}>
					<Text dimColor>Checking prerequisites…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'gated') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					End-to-end build
				</Text>
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
		const phaseHints: Record<PhaseKey, string> = {
			theme: '1 step',
			buildPatterns: `${p} pattern${p === 1 ? '' : 's'}`,
			buildContent: `${c} page${c === 1 ? '' : 's'}`,
			buildTemplates: `${t} template${t === 1 ? '' : 's'}`,
			refineContent: `${c} page${c === 1 ? '' : 's'}, auto-apply`,
			refineTemplates: `${t} template${t === 1 ? '' : 's'}, auto-apply`,
		};
		const items = PHASE_ORDER.map((key, idx) => ({
			key,
			label: `${idx + 1}. ${PHASE_TITLES[key]}`,
			hint: phaseHints[key],
			value: key,
		}));
		const planRef = phase.plan;
		const widthDefaults = phase.widthDefaults;
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					End-to-end build
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>
						Select phases to run. All are pre-selected — toggle any you want to
						skip.
					</Text>
					<Box marginTop={1}>
						<Text color="yellow" bold>
							Each selected phase issues paid agent calls.
						</Text>
					</Box>
					<Text dimColor>
						Existing artifacts in selected phases are overwritten. Diffs are
						auto-approved — no per-diff review. Per-pull failures are tallied,
						not fatal.
					</Text>
				</Box>
				<Box marginTop={1}>
					<MultiSelect
						items={items}
						onSubmit={values => {
							if (values.length === 0) {
								onDone();
								return;
							}
							const selected = new Set(values);
							// Only prompt for widths when the theme phase is in
							// the run AND at least one width isn't already filled
							// in on the existing theme.json. Skipping theme.json
							// means no rebuild — keep the existing widths;
							// pre-filled values likewise pass through silently.
							if (
								selected.has('theme') &&
								(widthDefaults.contentSize === '' ||
									widthDefaults.wideSize === '')
							) {
								setPhase({
									kind: 'widthsContent',
									plan: planRef,
									selected,
									defaults: widthDefaults,
								});
								return;
							}
							beginRun(planRef, selected, widthDefaults);
						}}
						onCancel={onDone}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'widthsContent') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					End-to-end build
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>
						theme.json needs `settings.layout.contentSize` and `wideSize`. These
						drive how every block resolves `align:&quot;wide&quot;` and the
						default content width. Type these in now.
					</Text>
				</Box>
				<Box marginTop={1}>
					<TextStep
						title="Content size (default content width)"
						hint="CSS length, e.g. 780px or 60rem. Submit empty to leave unset."
						placeholder="780px"
						initialValue={phase.defaults.contentSize}
						validate={validateLayoutLength}
						onSubmit={value =>
							setPhase({
								kind: 'widthsWide',
								plan: phase.plan,
								selected: phase.selected,
								contentSize: value,
								defaults: phase.defaults,
							})
						}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'widthsWide') {
		const planRef = phase.plan;
		const selectedRef = phase.selected;
		const contentSize = phase.contentSize;
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					End-to-end build
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text dimColor>
						contentSize = <Text bold>{contentSize || '<empty>'}</Text>
					</Text>
				</Box>
				<Box marginTop={1}>
					<TextStep
						title="Wide size (wide-alignment width)"
						hint={`CSS length used when a block sets align:"wide". Typically larger than contentSize.`}
						placeholder="1200px"
						initialValue={phase.defaults.wideSize}
						validate={validateLayoutLength}
						onSubmit={value =>
							beginRun(planRef, selectedRef, {
								contentSize,
								wideSize: value,
							})
						}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'running') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					End-to-end build
				</Text>
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

	if (phase.kind === 'paused') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					End-to-end build
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text bold color="yellow">
						{phase.currentLabel}
					</Text>
					<Text dimColor>
						Step {phase.currentIndex} / {phase.totalSteps} ·{' '}
						{formatElapsed(phase.elapsedMs)} elapsed · agent calls:{' '}
						{phase.tally.agentCalls} · cost: ${phase.tally.costUsd.toFixed(4)}
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Text>
							theme.json registered the font families it referenced, but the
							.woff2 binaries are not in this build. Drop your font files into{' '}
							<Text bold>
								wordpress/wp-content/themes/&lt;theme&gt;/assets/fonts/
							</Text>{' '}
							now, organised by family slug. The remaining phases (patterns →
							content → templates → refines) all render against the live theme,
							so missing fonts will show up as fallback typography in those
							captures.
						</Text>
						{phase.contentSizeMissing || phase.wideSizeMissing ? (
							<Box marginTop={1}>
								<Text color="yellow">
									{phase.contentSizeMissing && phase.wideSizeMissing
										? 'Also: theme.json settings.layout.contentSize and wideSize are unset. '
										: phase.contentSizeMissing
											? 'Also: theme.json settings.layout.contentSize is unset. '
											: 'Also: theme.json settings.layout.wideSize is unset. '}
									Build/refine agents resolve align:&quot;wide&quot; and the
									default content width against these values, so leaving them
									empty makes blocks render at the browser default. Edit
									theme.json now (e.g.{' '}
									<Text bold>contentSize: &quot;780px&quot;</Text>,{' '}
									<Text bold>wideSize: &quot;1200px&quot;</Text>) before
									continuing.
								</Text>
							</Box>
						) : null}
						<Box marginTop={1}>
							<Text bold>Press Enter to continue. Esc to cancel.</Text>
						</Box>
					</Box>
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
			<Text bold color="cyan">
				End-to-end build
			</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color={headlineColor} bold>
					{headline}
				</Text>
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text bold>Phases</Text>
				{phase.skipped.includes('theme') ? (
					<Text dimColor>{'  ⊘ theme.json (skipped)'}</Text>
				) : themeResult ? (
					<Text color={themeResult.outcome === 'ok' ? 'green' : 'red'}>
						{`  ${themeResult.outcome === 'ok' ? '✓' : '✗'} theme.json${
							themeResult.outcome === 'fail'
								? ` — ${themeResult.error ?? 'unknown'}`
								: ''
						}`}
					</Text>
				) : null}
				{phase.skipped.includes('buildPatterns') ? (
					<Text dimColor>{'  ⊘ build patterns (skipped)'}</Text>
				) : buildPatternsRes ? (
					<Text>
						{`  · build patterns: ${buildPatternsRes.ok} ok, ${buildPatternsRes.failed} failed`}
					</Text>
				) : null}
				{phase.skipped.includes('buildContent') ? (
					<Text dimColor>{'  ⊘ build content (skipped)'}</Text>
				) : buildContentRes ? (
					<Text>
						{`  · build content: ${buildContentRes.ok} ok, ${buildContentRes.failed} failed`}
					</Text>
				) : null}
				{phase.skipped.includes('buildTemplates') ? (
					<Text dimColor>{'  ⊘ build templates (skipped)'}</Text>
				) : buildTemplatesRes ? (
					<Text>
						{`  · build templates: ${buildTemplatesRes.ok} ok, ${buildTemplatesRes.failed} failed`}
					</Text>
				) : null}
				{phase.skipped.includes('refineContent') ? (
					<Text dimColor>{'  ⊘ refine content (skipped)'}</Text>
				) : refineContentRes ? (
					<Text>
						{`  · refine content: ${refineContentRes.applied} applied, ${refineContentRes.matched} matched, ${refineContentRes.failed} failed`}
					</Text>
				) : null}
				{phase.skipped.includes('refineTemplates') ? (
					<Text dimColor>{'  ⊘ refine templates (skipped)'}</Text>
				) : refineTemplatesRes ? (
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
				<Text bold>Total cost: ${phase.tally.costUsd.toFixed(4)}</Text>
				<Text>Agent calls: {phase.tally.agentCalls}</Text>
				<Text>Runtime: {formatElapsed(phase.elapsedMs)}</Text>
				{anyFailures || phase.cancelled ? (
					<Text dimColor>
						Note: token + cost totals can undercount when an agent call fails or
						is cancelled — the SDK doesn&apos;t always report usage on
						non-success results.
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
