// Refine an existing block-theme template to better match its design
// screenshot.
//
// Pipeline:
//   1. Read design/<slug>/screenshot.png. Its pixel dimensions drive
//      the browser viewport for capture.
//   2. Resolve the running site URL via ~/.studio/cli.json, append the
//      pull's previewPath. Capture the live page at design.width ×
//      design.height (DPR=1, viewport-only). Save as live.png.
//   3. odiff design.png vs live.png → diff.png + a pixel-diff ratio.
//      If under threshold (0.5%), report "matches" and exit.
//   4. visual-diff agent: 3 images + current template → JSON report.
//      If `matches_design: true`, exit with success.
//   5. User reviews the report in a checkbox UI; default-all-selected.
//      User toggles items off and submits, or cancels.
//   6. apply-diff agent: selected diffs + current template + theme.json
//      + variables.json → updated markup. Overwrite the template.
//
// All artifacts (live.png, diff.png, diff-report.json) live alongside
// the design screenshot for inspection.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../lib/menu.js';
import {access, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileAtomic} from '../lib/atomic-write.js';
import {
	AgentAbortedError,
	runAgent,
} from '../lib/agent-stream.js';
import {captureAtSize} from '../lib/browser-capture.js';
import {
	captureAndDiffPull,
	CaptureAbortedError,
	type DiffPull,
} from '../lib/template-diff.js';
import {listPulls, sortByTemplatePriority} from '../lib/design-walk.js';
import {
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	flushThemeJsonCache,
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
	type BlockStyleVariation,
	type ThemeJsonPatch,
} from '../lib/theme-json-patch.js';
import {
	parseAgentJson,
	parseBlockStyleVariationsField,
	parseThemeJsonPatchField,
} from '../lib/build-envelope.js';
import {
	extractDevAnnotations,
	formatDevAnnotationsSection,
} from '../lib/dev-annotations.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import MultiSelect from '../lib/multi-select.js';
import {openStudioSession} from '../integrations/studio/mcp.js';
import {
	dArrayLenient,
	dBoolean,
	dEnum,
	dNullable,
	dObject,
	dString,
	decode,
	type DecodeError,
} from '../lib/decode.js';
import {templateSubdir} from '../lib/template-scaffold.js';
import {placeholderInstructions} from './build-template.js';
import {
	readTemplate,
	targetLabel,
	templateTargetFor,
	writeTemplate,
	type TemplateTarget,
} from '../lib/wp-templates.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type PickablePull = DiffPull;

export type DiffEntry = {
	id: string;
	region: string;
	severity: 'high' | 'medium' | 'low';
	description: string;
	block_change?: string | null;
	style_change?: string | null;
	affects_layout: boolean;
};

export type DiffReport = {
	summary: string;
	matches_design: boolean;
	diffs: DiffEntry[];
};

const PIXEL_DIFF_THRESHOLD = 0.5; // percent
const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

type Phase =
	| {kind: 'loading'}
	| {kind: 'picking'; pulls: PickablePull[]}
	| {kind: 'capturing'; pull: PickablePull}
	| {
			kind: 'reviewing';
			pull: PickablePull;
			report: DiffReport;
			currentTemplate: string;
			target: TemplateTarget;
			themeJsonText: string | null;
			variablesText: string | null;
			devAnnotationsText: string | null;
			existingVariationsText: string | null;
	  }
	| {kind: 'applying'; pull: PickablePull}
	| {
			kind: 'success';
			resultPath: string;
			size: number;
			applied: AppliedEntry[];
			skipped: SkippedEntry[];
			themeJsonTouched: string[];
	  }
	| {kind: 'matched'; pull: PickablePull; ratio: number}
	| {kind: 'error'; error: string}
	| {kind: 'message'; title: string; subtitle?: string};

export default function RefineTemplate({activeProject, onDone}: Props) {
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
							'Pull a non-special template with a templateFile first. Content-only pulls are refined via build-content + a future refine-content flow.',
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

	const beginCapture = (pull: PickablePull) => {
		setPhase({kind: 'capturing', pull});
		setEvents([]);
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			try {
				const result = await runDiagnose(activeProject, pull, controller.signal, ev => {
					if (!controller.signal.aborted) {
						setEvents(prev => [...prev, ev]);
					}
				});
				if (controller.signal.aborted) return;
				if (result.kind === 'matched') {
					setPhase({kind: 'matched', pull, ratio: result.ratio});
					return;
				}
				setPhase({
					kind: 'reviewing',
					pull,
					report: result.report,
					currentTemplate: result.currentTemplate,
					target: result.target,
					themeJsonText: result.themeJsonText,
					variablesText: result.variablesText,
					devAnnotationsText: result.devAnnotationsText,
					existingVariationsText: result.existingVariationsText,
				});
			} catch (err) {
				if (controller.signal.aborted) return;
				if (err instanceof AgentAbortedError) return;
				setPhase({
					kind: 'error',
					error: err instanceof Error ? err.message : String(err),
				});
			}
		})();
	};

	const beginApply = (
		reviewPhase: Extract<Phase, {kind: 'reviewing'}>,
		approved: DiffEntry[],
	) => {
		if (approved.length === 0) {
			setPhase({
				kind: 'matched',
				pull: reviewPhase.pull,
				ratio: 0,
			});
			return;
		}
		setPhase({kind: 'applying', pull: reviewPhase.pull});
		setEvents([]);
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			try {
				const result = await runApply(
					activeProject,
					reviewPhase,
					approved,
					controller.signal,
					ev => {
						if (!controller.signal.aborted) {
							setEvents(prev => [...prev, ev]);
						}
					},
				);
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'success',
					resultPath: result.path,
					size: result.size,
					applied: result.applied,
					skipped: result.skipped,
					themeJsonTouched: result.themeJsonTouched,
				});
			} catch (err) {
				if (controller.signal.aborted) return;
				if (err instanceof AgentAbortedError) return;
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
				phase.kind === 'success' ||
				phase.kind === 'matched' ||
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
				phase.kind === 'success' ||
				phase.kind === 'matched' ||
				phase.kind === 'error' ||
				phase.kind === 'picking',
		},
	);

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine template</Text>
				<Text dimColor>Loading pulls…</Text>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine template</Text>
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
				<Text bold color="cyan">Refine template</Text>
				<Box marginTop={1}>
					<Text bold>Pick a pull to refine:</Text>
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

	if (phase.kind === 'reviewing') {
		const items = phase.report.diffs.map(d => ({
			key: d.id,
			label: `[${d.severity}] ${d.region} — ${d.description}`,
			hint: d.block_change ?? d.style_change ?? undefined,
			value: d,
		}));
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine template</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>{phase.report.summary}</Text>
					<Text dimColor>
						{phase.report.diffs.length} diff
						{phase.report.diffs.length === 1 ? '' : 's'} — toggle to choose what
						to apply.
					</Text>
				</Box>
				<Box marginTop={1}>
					<MultiSelect
						items={items}
						onSubmit={approved => beginApply(phase, approved)}
						onCancel={onDone}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'matched') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine template</Text>
				<Box marginTop={1}>
					<Text color="green" bold>
						✓ Live render already matches the design (diff{' '}
						{phase.ratio.toFixed(2)}%).
					</Text>
				</Box>
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	const status = phase.kind === 'success' ? 'success' : phase.kind === 'error' ? 'error' : 'running';

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Refine template</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{phase.kind === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>
						✓ Applied {phase.applied.length} of{' '}
						{phase.applied.length + phase.skipped.length} diff
						{phase.applied.length + phase.skipped.length === 1 ? '' : 's'}
						{phase.themeJsonTouched.length > 0
							? `, patched theme.json (${phase.themeJsonTouched.join(', ')})`
							: ''}{' '}
						({phase.size} bytes).
					</Text>
					{phase.applied.length > 0 ? (
						<Box flexDirection="column" marginTop={1}>
							{phase.applied.map(a => (
								<Text key={a.id} color="green">
									{'  ✓ '}
									<Text bold>{a.id}:</Text> {a.summary}
								</Text>
							))}
						</Box>
					) : null}
					{phase.skipped.length > 0 ? (
						<Box flexDirection="column" marginTop={1}>
							{phase.skipped.map(s => (
								<Text key={s.id} color="yellow">
									{'  ! '}
									<Text bold>{s.id}:</Text> {s.reason}
								</Text>
							))}
						</Box>
					) : null}
					<Box marginTop={1}>
						<Text dimColor>{phase.resultPath}</Text>
					</Box>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
			{phase.kind === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>✗ Refine failed.</Text>
					<Text color="red">{phase.error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
		</Box>
	);
}

type DiagnoseDeps = {
	runAgent?: typeof runAgent;
	captureAtSize?: typeof captureAtSize;
};

type DiagnoseResult =
	| {kind: 'matched'; ratio: number}
	| {
			kind: 'report';
			report: DiffReport;
			currentTemplate: string;
			target: TemplateTarget;
			themeJsonText: string | null;
			variablesText: string | null;
			devAnnotationsText: string | null;
			existingVariationsText: string | null;
	  };

export async function runDiagnose(
	loaded: Loaded,
	pull: PickablePull,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: DiagnoseDeps = {},
): Promise<DiagnoseResult> {
	const agentRunner = deps.runAgent ?? runAgent;
	const capture = deps.captureAtSize ?? captureAtSize;

	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config.json — finish theme setup first.',
		);
	}

	const target = templateTargetFor(pull.templateFile, pull.pageName);
	const wpRoot = resolve(loaded.dir, 'wordpress');
	const filePath = templatePath(loaded.dir, themeSlug, pull.templateFile);
	const currentTemplate = await loadCurrentTemplate(
		wpRoot,
		target,
		filePath,
	);
	if (!currentTemplate.trim()) {
		throw new Error(
			`No template content found for ${targetLabel(target)}. Run Build template first.`,
		);
	}
	onEvent({
		kind: 'step',
		message: `Loaded current template (${currentTemplate.length} bytes)`,
	});

	let captured;
	try {
		captured = await captureAndDiffPull(loaded, pull, signal, onEvent, {
			captureAtSize: capture,
		});
	} catch (err) {
		if (err instanceof CaptureAbortedError) throw new AgentAbortedError();
		throw err;
	}
	const {designBuf, liveBuf, diffPath, outcome, sizeNote} = captured;

	if (!outcome.ok) {
		throw new Error(
			`odiff failed: ${outcome.reason} ${outcome.file ?? ''}`,
		);
	}

	if (outcome.match) {
		onEvent({kind: 'success', message: 'Pixel-perfect match'});
		return {kind: 'matched', ratio: 0};
	}

	// odiff returns layout-diff only when padding fails or is skipped;
	// captureAndDiffPull always pads to a common canvas first. Treat
	// any non-match as pixel-diff.
	if (outcome.kind !== 'pixel-diff') {
		throw new Error(
			'Padded diff produced layout-diff — should be unreachable.',
		);
	}

	if (outcome.diffPercentage < PIXEL_DIFF_THRESHOLD && !sizeNote) {
		onEvent({
			kind: 'success',
			message: `Diff ${outcome.diffPercentage.toFixed(2)}% < ${PIXEL_DIFF_THRESHOLD}% threshold; treating as match`,
		});
		return {kind: 'matched', ratio: outcome.diffPercentage};
	}

	onEvent({
		kind: 'step',
		message: `Diff ${outcome.diffCount} px (${outcome.diffPercentage.toFixed(2)}%) → diff.png`,
	});
	const diffBase64 = (await readFile(diffPath)).toString('base64');

	const themeJsonPath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		'theme.json',
	);
	const themeJsonText = await readIfExists(themeJsonPath);
	const variablesText = await readIfExists(
		join(loaded.dir, 'variables', 'all-variables.json'),
	);
	const themePath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
	);
	const existingVariations = await readBlockStyleVariations(
		themePath,
		msg => onEvent({kind: 'warn', message: msg}),
	);
	const existingVariationsText = formatBlockStyleVariationsContext(
		existingVariations,
	);
	if (existingVariationsText) {
		onEvent({
			kind: 'step',
			message: `Loaded ${existingVariations.length} existing block style variation${existingVariations.length === 1 ? '' : 's'} for reuse context`,
		});
	}

	// code.tsx carries inline data-development-annotations the designer
	// authored in Figma. Surface them to both agents as explicit context;
	// missing or annotation-less files just produce a null section.
	const codeText = await readIfExists(
		join(loaded.dir, 'design', pull.slug, 'code.tsx'),
	);
	const devAnnotations = codeText ? extractDevAnnotations(codeText) : [];
	const devAnnotationsText =
		devAnnotations.length > 0
			? formatDevAnnotationsSection(devAnnotations)
			: null;
	if (devAnnotationsText) {
		const noteCount = devAnnotations.reduce(
			(sum, a) => sum + a.notes.length,
			0,
		);
		onEvent({
			kind: 'step',
			message: `Captured ${noteCount} dev annotation${noteCount === 1 ? '' : 's'} on ${devAnnotations.length} node${devAnnotations.length === 1 ? '' : 's'}`,
		});
	}

	const designBase64 = designBuf.toString('base64');
	const liveBase64 = liveBuf.toString('base64');

	onEvent({kind: 'step', message: 'Invoking visual-diff agent…'});

	const headerParts: string[] = [
		`Compare these screenshots of the same WordPress page.`,
		`Use the visual-diff skill.`,
		`Template file: ${pull.templateFile}.`,
		`Pixel-diff ratio: ${outcome.diffPercentage.toFixed(2)}%.`,
	];
	if (sizeNote) {
		headerParts.push(
			`${sizeNote} Both images were padded to a common canvas before diffing; magenta regions in diff.png mark areas where one side has no content (i.e. one side is taller/wider than the other).`,
		);
	}

	const reportText = await agentRunner(
		[
			{type: 'text', text: headerParts.join(' ')},
			{type: 'text', text: '=== design.png — target (Figma) ==='},
			{
				type: 'image',
				source: {type: 'base64', media_type: 'image/png', data: designBase64},
			},
			{type: 'text', text: '=== live.png — current render ==='},
			{
				type: 'image',
				source: {type: 'base64', media_type: 'image/png', data: liveBase64},
			},
			{type: 'text', text: '=== diff.png — pixel-difference highlight ==='},
			{
				type: 'image',
				source: {type: 'base64', media_type: 'image/png', data: diffBase64},
			},
			{
				type: 'text',
				text: buildContextSection(
					currentTemplate,
					themeJsonText,
					devAnnotationsText,
					existingVariationsText,
				),
			},
		],
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	const report = parseDiffReport(reportText, msg =>
		onEvent({kind: 'warn', message: msg}),
	);
	const reportPath = join(loaded.dir, 'design', pull.slug, 'diff-report.json');
	await writeFileAtomic(reportPath, JSON.stringify(report, null, 2) + '\n');
	onEvent({
		kind: 'step',
		message: `Wrote diff-report.json (${report.diffs.length} diff${
			report.diffs.length === 1 ? '' : 's'
		})`,
	});

	if (report.matches_design) {
		const ratio = outcome.kind === 'pixel-diff' ? outcome.diffPercentage : 0;
		return {kind: 'matched', ratio};
	}

	return {
		kind: 'report',
		report,
		currentTemplate,
		target,
		themeJsonText,
		variablesText,
		devAnnotationsText,
		existingVariationsText,
	};
}

type ApplyDeps = {
	runAgent?: typeof runAgent;
};

export type AppliedEntry = {
	id: string;
	summary: string;
};

export type SkippedEntry = {
	id: string;
	reason: string;
};

export type ApplyEnvelope = {
	template_html: string;
	theme_json_patch?: ThemeJsonPatch;
	block_style_variations?: BlockStyleVariation[];
	applied: AppliedEntry[];
	skipped: SkippedEntry[];
};

export async function runApply(
	loaded: Loaded,
	reviewPhase: {
		pull: PickablePull;
		currentTemplate: string;
		target: TemplateTarget;
		themeJsonText: string | null;
		variablesText: string | null;
		devAnnotationsText: string | null;
		existingVariationsText: string | null;
	},
	approved: DiffEntry[],
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: ApplyDeps = {},
): Promise<{
	path: string;
	size: number;
	applied: AppliedEntry[];
	skipped: SkippedEntry[];
	themeJsonTouched: string[];
}> {
	const agentRunner = deps.runAgent ?? runAgent;

	const sections: string[] = [
		'=== diffs.json ===',
		JSON.stringify(approved, null, 2),
		'',
		'=== current.html ===',
		reviewPhase.currentTemplate,
	];
	if (reviewPhase.themeJsonText) {
		sections.push('', '=== theme.json ===', reviewPhase.themeJsonText);
	}
	if (reviewPhase.variablesText) {
		sections.push('', '=== variables.json ===', reviewPhase.variablesText);
	}
	if (reviewPhase.existingVariationsText) {
		sections.push(
			'',
			'=== existing block style variations ===',
			'These variations are already registered in this theme. Reuse them by applying the matching `is-style-<slug>` class instead of redefining them. Only emit a new entry in `block_style_variations[]` when none of these fits.',
			reviewPhase.existingVariationsText,
		);
	}
	if (reviewPhase.devAnnotationsText) {
		sections.push(
			'',
			'=== dev annotations ===',
			reviewPhase.devAnnotationsText,
		);
	}
	const placeholder = loaded.config.placeholderImage;
	if (placeholder) {
		sections.push('', '=== placeholder image ===', placeholderInstructions(placeholder));
	}

	onEvent({kind: 'step', message: 'Invoking apply-diff agent…'});

	const responseText = await agentRunner(
		[
			{
				type: 'text',
				text:
					`Apply this list of approved visual diffs to the existing Gutenberg block markup template (${reviewPhase.pull.templateFile}). ` +
					`Use the apply-diff skill. Apply only the supplied diffs; do not introduce new ones. ` +
					`Return the JSON envelope described in the skill. Neptune persists the template and applies the optional theme.json patch directly — do NOT call any tools yourself.`,
			},
			{type: 'text', text: sections.join('\n')},
		],
		{
			cwd: loaded.dir,
			pluginPath: PLUGIN_PATH,
			signal,
		},
		onEvent,
	);

	const envelope = parseApplyEnvelope(responseText, msg =>
		onEvent({kind: 'warn', message: msg}),
	);
	validateApplyCoverage(envelope, approved.map(a => a.id));

	for (const entry of envelope.applied) {
		onEvent({
			kind: 'success',
			message: `Applied ${entry.id}: ${entry.summary}`,
		});
	}
	for (const entry of envelope.skipped) {
		onEvent({
			kind: 'warn',
			message: `Skipped ${entry.id}: ${entry.reason}`,
		});
	}

	const out = envelope.template_html.endsWith('\n')
		? envelope.template_html
		: envelope.template_html + '\n';

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config.json — finish theme setup first.',
		);
	}
	const themeJsonPath = resolve(
		wpRoot,
		'wp-content',
		'themes',
		themeSlug,
		'theme.json',
	);

	let themeJsonTouched: string[] = [];
	const themePath = resolve(wpRoot, 'wp-content', 'themes', themeSlug);
	const session = await openStudioSession({signal});
	let cacheNeedsFlush = false;
	try {
		await writeTemplate(session, wpRoot, reviewPhase.target, out);
		if (envelope.theme_json_patch) {
			const patchResult = await applyThemeJsonPatch(
				themeJsonPath,
				envelope.theme_json_patch,
			);
			if (patchResult.wrote) {
				themeJsonTouched = patchResult.touched;
				onEvent({
					kind: 'success',
					message: `Patched theme.json (${patchResult.touched.join(', ')})`,
				});
				cacheNeedsFlush = true;
			}
		}
		if (envelope.block_style_variations) {
			const writeResult = await applyBlockStyleVariations(
				themePath,
				envelope.block_style_variations,
			);
			if (writeResult.written.length > 0) {
				onEvent({
					kind: 'success',
					message: `Registered ${writeResult.written.length} block style variation${writeResult.written.length === 1 ? '' : 's'}`,
				});
				cacheNeedsFlush = true;
			}
		}
		if (cacheNeedsFlush) {
			await flushThemeJsonCache(session, wpRoot);
		}
	} finally {
		session.close();
	}

	const label = targetLabel(reviewPhase.target);
	onEvent({
		kind: 'success',
		message: `Wrote ${out.length} bytes to ${label}`,
	});

	return {
		path: label,
		size: out.length,
		applied: envelope.applied,
		skipped: envelope.skipped,
		themeJsonTouched,
	};
}

const dApplyEntry = dObject({id: dString, summary: dString});
const dSkipEntry = dObject({id: dString, reason: dString});

// Validates the apply-diff agent's JSON envelope. Throws on top-level
// schema mismatches; per-entry failures in applied / skipped are
// reported via onWarn and the entry is dropped. theme_json_patch is
// validated structurally (object or absent) but its inner shape is
// trusted — applyThemeJsonPatch enforces what subtrees are reachable.
export function parseApplyEnvelope(
	input: string,
	onWarn?: (msg: string) => void,
): ApplyEnvelope {
	const parsed = parseAgentJson(input, 'apply-diff');
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('apply-diff response is not a JSON object.');
	}
	const obj = parsed as Record<string, unknown>;

	const html = obj['template_html'];
	if (typeof html !== 'string' || !html.trim()) {
		throw new Error('apply-diff envelope is missing a non-empty template_html.');
	}

	const drop = (kind: string) => (path: string, err: DecodeError) => {
		onWarn?.(`Dropped ${kind} entry at ${path}: ${err.message}`);
	};

	const applied = decode(
		dArrayLenient(dApplyEntry, drop('applied')),
		obj['applied'] ?? [],
		'apply-diff.applied',
	);
	const skipped = decode(
		dArrayLenient(dSkipEntry, drop('skipped')),
		obj['skipped'] ?? [],
		'apply-diff.skipped',
	);

	const theme_json_patch = parseThemeJsonPatchField(
		obj['theme_json_patch'],
		'apply-diff',
	);
	const block_style_variations = parseBlockStyleVariationsField(
		obj['block_style_variations'],
		'apply-diff',
	);

	return {
		template_html: html,
		applied,
		skipped,
		theme_json_patch,
		block_style_variations,
	};
}


// Verifies the agent accounted for every approved diff (each id appears
// in either `applied` or `skipped`). Throws if any are unaccounted for —
// previous behaviour silently dropped diffs and the user had no way to
// tell what landed.
export function validateApplyCoverage(
	envelope: ApplyEnvelope,
	approvedIds: string[],
): void {
	const accounted = new Set([
		...envelope.applied.map(a => a.id),
		...envelope.skipped.map(s => s.id),
	]);
	const missing = approvedIds.filter(id => !accounted.has(id));
	if (missing.length === 0) return;
	throw new Error(
		`apply-diff agent did not account for diff id${
			missing.length === 1 ? '' : 's'
		}: ${missing.join(', ')}. ` +
			'Each approved diff must appear in "applied" or "skipped".',
	);
}

// Loads the current template content from the database first (where
// Site Editor and Neptune both write); falls back to the theme's
// shipped file if there's no DB row yet.
async function loadCurrentTemplate(
	wpRoot: string,
	target: TemplateTarget,
	filePath: string,
): Promise<string> {
	const session = await openStudioSession();
	let dbContent: string | null;
	try {
		dbContent = await readTemplate(session, wpRoot, target);
	} finally {
		session.close();
	}
	if (dbContent !== null) return dbContent;

	try {
		return await readFile(filePath, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(
				`Template ${targetLabel(target)} doesn't exist yet (no DB row, no file at ${filePath}). Run Build template first.`,
			);
		}
		throw err;
	}
}

function buildContextSection(
	currentTemplate: string,
	themeJsonText: string | null,
	devAnnotationsText: string | null,
	existingVariationsText: string | null,
): string {
	const parts = ['=== current.html ===', currentTemplate];
	if (themeJsonText) {
		parts.push('', '=== theme.json ===', themeJsonText);
	}
	if (existingVariationsText) {
		parts.push(
			'',
			'=== existing block style variations ===',
			'These variations are already registered in this theme. When proposing a diff that needs an alternative block style, prefer reusing one of these (apply the matching `is-style-<slug>` class) over inventing a new one.',
			existingVariationsText,
		);
	}
	if (devAnnotationsText) {
		parts.push('', '=== dev annotations ===', devAnnotationsText);
	}
	return parts.join('\n');
}

const dDiffEntry = dObject({
	id: dString,
	region: dString,
	severity: dEnum('high', 'medium', 'low'),
	description: dString,
	block_change: dNullable(dString),
	style_change: dNullable(dString),
	affects_layout: dBoolean,
});

// Validates and narrows the visual-diff agent's response. Throws on
// top-level schema mismatch; per-entry failures are reported via
// onWarn and the entry is dropped. Duplicate ids are dropped first-wins.
export function parseDiffReport(
	input: string,
	onWarn?: (msg: string) => void,
): DiffReport {
	const parsed = parseAgentJson(input, 'visual-diff');
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('visual-diff response is not a JSON object');
	}
	const obj = parsed as Record<string, unknown>;
	const summary = typeof obj['summary'] === 'string' ? obj['summary'] : '';
	const matchesDesign = obj['matches_design'] === true;

	if (matchesDesign) return {summary, matches_design: true, diffs: []};

	const rawDiffs = decode(
		dArrayLenient(dDiffEntry, (path, err) => {
			onWarn?.(`Dropped diff entry at ${path}: ${err.message}`);
		}),
		obj['diffs'] ?? [],
		'visual-diff.diffs',
	);

	const seen = new Set<string>();
	const diffs: DiffEntry[] = [];
	for (const entry of rawDiffs) {
		if (seen.has(entry.id)) {
			onWarn?.(`Dropped duplicate diff id "${entry.id}"`);
			continue;
		}
		seen.add(entry.id);
		diffs.push({
			id: entry.id,
			region: entry.region,
			severity: entry.severity,
			description: entry.description,
			block_change: entry.block_change ?? undefined,
			style_change: entry.style_change ?? undefined,
			affects_layout: entry.affects_layout,
		});
	}

	return {summary, matches_design: false, diffs};
}

function templatePath(
	projectDir: string,
	themeSlug: string,
	templateFile: string,
): string {
	return resolve(
		projectDir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		templateSubdir(templateFile),
		templateFile,
	);
}

async function readIfExists(p: string): Promise<string | null> {
	try {
		await access(p);
		return await readFile(p, 'utf8');
	} catch {
		return null;
	}
}

