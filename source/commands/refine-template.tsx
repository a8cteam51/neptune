// Refine an existing block-theme template to better match its design
// screenshot. Pickers + gating mirror Build template (non-special pulls
// with a templateFile, themeSlug required). Run sequence:
//
//   1. Read the pull's design/<slug>/screenshot.png (target).
//   2. Resolve the running site URL via ~/.studio/cli.json.
//   3. Capture the rendered template via studio mcp `take_screenshot`
//      at the desktop preset (1040×1248). Save to design/<slug>/
//      rendered.png so it's inspectable later.
//   4. Pixel-diff design vs rendered. If they share dimensions, save
//      design/<slug>/diff.png and feed it to the agent. If they don't,
//      skip the diff with a warning — diffing different resolutions
//      would silently mislead the model.
//   5. Run the refine-blocks skill with: current template HTML,
//      design.png, rendered.png, optional diff.png, theme.json,
//      variables.json. Overwrite the template with the response.
//
// Studio's take_screenshot only supports 'desktop' (1040×1248) and
// 'mobile' (390×844) presets — we can't currently match the Figma
// metadata-defined viewport width (typically 1440). The pull's
// expectedWidth/expectedHeight (written by Verify screenshots) is
// surfaced as context for the agent but doesn't yet drive capture.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {access, mkdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Buffer} from 'node:buffer';
import {writeFileAtomic} from '../lib/atomic-write.js';
import {
	AgentAbortedError,
	runAgent,
	type ContentBlock,
	type ImageBlock,
	type TextBlock,
} from '../lib/agent-stream.js';
import {listPulls} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {diffPngs} from '../lib/image-diff.js';
import {
	getSiteUrlFromStudioConfig,
	openStudioSession,
	takeScreenshot,
} from '../integrations/studio/mcp.js';
import {templateSubdir} from '../lib/template-scaffold.js';
import type {Loaded} from './setup-project/types.js';
import type {PullMeta} from '../lib/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type PickablePull = PullMeta & {templateFile: string};

type Phase =
	| {kind: 'loading'}
	| {kind: 'picking'; pulls: PickablePull[]}
	| {kind: 'running'; pull: PickablePull}
	| {kind: 'success'; resultPath: string; size: number}
	| {kind: 'error'; error: string}
	| {kind: 'message'; title: string; subtitle?: string};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

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
				setPhase({kind: 'picking', pulls: pickable});
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

	const beginRun = (pull: PickablePull) => {
		setPhase({kind: 'running', pull});
		setEvents([]);
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			try {
				const result = await runRefine(
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
				setPhase({
					kind: 'success',
					resultPath: result.path,
					size: result.size,
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
				phase.kind === 'error' ||
				phase.kind === 'picking',
		},
	);

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Refine template</Text>
				<Box marginTop={1}>
					<Text dimColor>Loading pulls…</Text>
				</Box>
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
					<SelectInput
						items={items}
						onSelect={item => beginRun(item.value)}
					/>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Esc to cancel.</Text>
				</Box>
			</Box>
		);
	}

	const status =
		phase.kind === 'running'
			? 'running'
			: phase.kind === 'success'
				? 'success'
				: 'error';

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Refine template</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{phase.kind === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>
						✓ Template refined ({phase.size} bytes).
					</Text>
					<Text dimColor>{phase.resultPath}</Text>
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

export type RefineDeps = {
	runAgent?: typeof runAgent;
};

export async function runRefine(
	loaded: Loaded,
	pull: PickablePull,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: RefineDeps = {},
): Promise<{path: string; size: number}> {
	const agentRunner = deps.runAgent ?? runAgent;
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error(
			'themeSlug missing from neptune-config.json — finish theme setup first.',
		);
	}

	const target = templatePath(loaded.dir, themeSlug, pull.templateFile);
	const currentTemplate = await readFile(target, 'utf8').catch(err => {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error(
				`Template ${target} doesn't exist yet. Run Build template first.`,
			);
		}
		throw err;
	});
	if (!currentTemplate.trim()) {
		throw new Error(
			`Template ${target} is empty. Run Build template first.`,
		);
	}
	onEvent({
		kind: 'step',
		message: `Loaded current template (${currentTemplate.length} bytes)`,
	});

	const designPath = join(loaded.dir, 'design', pull.slug, 'screenshot.png');
	const designBuf = await readBufferIfExists(designPath);
	if (!designBuf) {
		throw new Error(`No design screenshot at ${designPath}.`);
	}
	onEvent({
		kind: 'step',
		message: `Loaded design screenshot (${designBuf.length} bytes)`,
	});

	if (pull.expectedWidth && pull.expectedHeight) {
		onEvent({
			kind: 'step',
			message: `Expected viewport (from metadata): ${pull.expectedWidth}×${pull.expectedHeight}`,
		});
	} else {
		onEvent({
			kind: 'warn',
			message:
				'No expectedWidth/expectedHeight in meta.json — run Verify screenshots to record it',
		});
	}

	const siteUrl = await getSiteUrlFromStudioConfig(loaded.dir);
	if (!siteUrl) {
		throw new Error(
			'Could not resolve the running site URL from ~/.studio/cli.json. Is the site registered with Studio?',
		);
	}
	const previewUrl = siteUrl + previewPathFor(pull.templateFile);
	onEvent({kind: 'step', message: `Capturing ${previewUrl}`});

	const studio = await openStudioSession({signal});
	let renderedBuf: Buffer;
	try {
		renderedBuf = await takeScreenshot(studio, previewUrl, 'desktop');
	} finally {
		studio.close();
	}

	if (signal.aborted) throw new AgentAbortedError();

	const renderedPath = join(loaded.dir, 'design', pull.slug, 'rendered.png');
	await writeFileAtomic(renderedPath, renderedBuf);
	onEvent({
		kind: 'step',
		message: `Saved rendered.png (${renderedBuf.length} bytes)`,
	});

	const diffPath = join(loaded.dir, 'design', pull.slug, 'diff.png');
	let diffBase64: string | null = null;
	let diffRatio: number | null = null;
	const outcome = diffPngs(designBuf, renderedBuf);
	if (outcome.ok) {
		await writeFileAtomic(diffPath, outcome.diff.pngBuffer);
		const pct = (outcome.diff.ratio * 100).toFixed(2);
		onEvent({
			kind: 'step',
			message: `Diff: ${outcome.diff.pixelsDiffered} of ${outcome.diff.totalPixels} px differ (${pct}%) → diff.png`,
		});
		diffBase64 = outcome.diff.pngBuffer.toString('base64');
		diffRatio = outcome.diff.ratio;
	} else {
		onEvent({
			kind: 'warn',
			message: `Skipping diff — design ${outcome.a.width}×${outcome.a.height} vs rendered ${outcome.b.width}×${outcome.b.height}. Resize the design screenshot to ${outcome.b.width}×${outcome.b.height} for a pixel diff.`,
		});
	}

	const themeJsonPath = resolve(
		loaded.dir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		'theme.json',
	);
	const themeJsonText = await readIfExists(themeJsonPath);
	if (themeJsonText) {
		onEvent({
			kind: 'step',
			message: `Loaded theme.json (${themeJsonText.length} bytes)`,
		});
	}
	const variablesText = await readIfExists(
		join(loaded.dir, 'variables', 'all-variables.json'),
	);
	if (variablesText) {
		onEvent({
			kind: 'step',
			message: `Loaded variables/all-variables.json (${variablesText.length} bytes)`,
		});
	}

	const userContent = buildRefineContent({
		templateFile: pull.templateFile,
		currentTemplate,
		designBase64: designBuf.toString('base64'),
		renderedBase64: renderedBuf.toString('base64'),
		diffBase64,
		diffRatio,
		themeJsonText,
		variablesText,
	});

	onEvent({kind: 'step', message: 'Invoking Claude Agent SDK…'});
	const refined = await agentRunner(
		userContent,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	await mkdir(dirname(target), {recursive: true});
	const out = refined.endsWith('\n') ? refined : refined + '\n';
	await writeFileAtomic(target, out);

	onEvent({
		kind: 'success',
		message: `Wrote ${out.length} bytes to ${target}`,
	});

	return {path: target, size: out.length};
}

type RefineInputs = {
	templateFile: string;
	currentTemplate: string;
	designBase64: string;
	renderedBase64: string;
	diffBase64: string | null;
	diffRatio: number | null;
	themeJsonText: string | null;
	variablesText: string | null;
};

function buildRefineContent(inputs: RefineInputs): ContentBlock[] {
	const content: ContentBlock[] = [];

	const ratioNote =
		inputs.diffRatio === null
			? ''
			: ` Pixel-diff ratio: ${(inputs.diffRatio * 100).toFixed(2)}%.`;
	content.push(
		textBlock(
			`Refine this existing Gutenberg block markup template (${inputs.templateFile}) to better match the design screenshot. Use the refine-blocks skill.${ratioNote}`,
		),
	);

	content.push(textBlock('=== design.png — target (Figma screenshot) ==='));
	content.push(imageBlock(inputs.designBase64));

	content.push(textBlock('=== rendered.png — current live render ==='));
	content.push(imageBlock(inputs.renderedBase64));

	if (inputs.diffBase64) {
		content.push(textBlock('=== diff.png — pixel-difference highlight ==='));
		content.push(imageBlock(inputs.diffBase64));
	}

	const sections: string[] = [
		'=== current.html ===',
		inputs.currentTemplate,
	];
	if (inputs.themeJsonText) {
		sections.push('', '=== theme.json ===', inputs.themeJsonText);
	}
	if (inputs.variablesText) {
		sections.push('', '=== variables.json ===', inputs.variablesText);
	}
	content.push(textBlock(sections.join('\n')));

	return content;
}

function textBlock(text: string): TextBlock {
	return {type: 'text', text};
}

function imageBlock(base64: string): ImageBlock {
	return {
		type: 'image',
		source: {type: 'base64', media_type: 'image/png', data: base64},
	};
}

function previewPathFor(templateFile: string): string {
	const stem = templateFile.replace(/\.html$/i, '').toLowerCase();
	if (stem === 'front-page' || stem === 'index' || stem === 'home') return '/';
	if (stem === '404') return '/this-path-should-404';
	// Template parts (header/footer) and unknown templates fall back to the
	// home page — they render in context there. Future: persist a per-pull
	// previewPath so the user can override.
	return '/';
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

async function readBufferIfExists(p: string): Promise<Buffer | null> {
	try {
		await access(p);
		return await readFile(p);
	} catch {
		return null;
	}
}

async function readIfExists(p: string): Promise<string | null> {
	try {
		await access(p);
		return await readFile(p, 'utf8');
	} catch {
		return null;
	}
}
