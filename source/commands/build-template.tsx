// Picks one non-special pull, feeds its design/<slug>/code.tsx (plus the
// theme's theme.json and variables/all-variables.json when present) to the
// Claude Agent SDK with the tsx-to-blocks skill, and writes the resulting
// Gutenberg block markup to the pull's wp_template / wp_template_part
// post in the WordPress database via Studio's wp_cli.
//
// Modeled on build-theme-json.tsx: confirm-overwrite gate when a DB row
// already exists so the user doesn't lose hand edits (Site Editor or
// previous Neptune runs) and doesn't pay for a regen they didn't intend.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../lib/menu.js';
import {access, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	AgentAbortedError,
	runAgent,
	type ImageBlock,
	type TextBlock,
} from '../lib/agent-stream.js';
import {listPulls, sortByTemplatePriority} from '../lib/design-walk.js';
import {
	extractDevAnnotations,
	formatDevAnnotationsSection,
} from '../lib/dev-annotations.js';
import {
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	flushThemeJsonCache,
} from '../lib/theme-json-patch.js';
import {parseBuildEnvelope} from '../lib/build-envelope.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {templateRole, type TemplateRole} from '../lib/template-scaffold.js';
import {
	readTemplate,
	targetLabel,
	templateTargetFor,
	writeTemplate,
} from '../lib/wp-templates.js';
import {openStudioSession} from '../integrations/studio/mcp.js';
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
	| {kind: 'confirm'; pull: PickablePull; targetLabel: string}
	| {kind: 'running'; pull: PickablePull}
	| {kind: 'success'; resultPath: string; size: number}
	| {kind: 'error'; error: string}
	| {kind: 'message'; title: string; subtitle?: string};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

export default function BuildTemplate({activeProject, onDone}: Props) {
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
						title: 'No pulls available to build a template from.',
						subtitle:
							'Pull a non-special template with a templateFile first. Content-only pulls are built via build-content.',
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

	const beginRun = (pull: PickablePull) => {
		setPhase({kind: 'running', pull});
		setEvents([]);
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
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

	const onPickPull = async (pull: PickablePull) => {
		const themeSlug = activeProject.config.themeSlug;
		if (!themeSlug) {
			setPhase({
				kind: 'message',
				title: 'themeSlug missing from neptune-config.json.',
				subtitle: 'Finish theme setup first.',
			});
			return;
		}
		const target = templateTargetFor(pull.templateFile, pull.pageName);
		const wpRoot = resolve(activeProject.dir, 'wordpress');
		let exists = false;
		try {
			const session = await openStudioSession();
			try {
				exists = (await readTemplate(session, wpRoot, target)) !== null;
			} finally {
				session.close();
			}
		} catch (err) {
			setPhase({
				kind: 'message',
				title: 'Could not check existing template in the database.',
				subtitle: err instanceof Error ? err.message : String(err),
			});
			return;
		}
		if (exists) {
			setPhase({kind: 'confirm', pull, targetLabel: targetLabel(target)});
		} else {
			beginRun(pull);
		}
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
				<Text bold color="cyan">Build template</Text>
				<Box marginTop={1}>
					<Text dimColor>Loading pulls…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build template</Text>
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
				<Text bold color="cyan">Build template</Text>
				<Box marginTop={1}>
					<Text bold>Pick a pull to build into the theme:</Text>
				</Box>
				<Box marginTop={1}>
					<Menu
						items={items}
						onSelect={item => {
							void onPickPull(item.value);
						}}
					/>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Esc to cancel.</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'confirm') {
		return (
			<ConfirmOverwrite
				targetLabel={phase.targetLabel}
				onProceed={() => beginRun(phase.pull)}
				onCancel={onDone}
			/>
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
			<Text bold color="cyan">Build template</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{phase.kind === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>
						✓ Template written ({phase.size} bytes).
					</Text>
					<Text dimColor>{phase.resultPath}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
			{phase.kind === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>✗ Build failed.</Text>
					<Text color="red">{phase.error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
		</Box>
	);
}

function ConfirmOverwrite({
	targetLabel,
	onProceed,
	onCancel,
}: {
	targetLabel: string;
	onProceed: () => void;
	onCancel: () => void;
}) {
	useInput((_input, key) => {
		if (key.escape) onCancel();
	});

	const items = [
		{
			key: 'cancel',
			label: 'Cancel — keep existing template',
			value: 'cancel',
		},
		{
			key: 'proceed',
			label: 'Overwrite and run the build',
			value: 'proceed',
		},
	];

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Build template</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color="yellow" bold>
					A template post already exists in the database.
				</Text>
				<Text dimColor>{targetLabel}</Text>
				<Box marginTop={1}>
					<Text>
						Running the build will overwrite the existing post (revision
						history is preserved) and consume a paid Claude Agent SDK call.
					</Text>
				</Box>
			</Box>
			<Box marginTop={1}>
				<Menu
					items={items}
					onSelect={item => {
						if (item.value === 'proceed') onProceed();
						else onCancel();
					}}
				/>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>Esc to cancel.</Text>
			</Box>
		</Box>
	);
}

export type BuildDeps = {
	runAgent?: typeof runAgent;
};

export async function runBuild(
	loaded: Loaded,
	pull: PickablePull,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: BuildDeps = {},
): Promise<{path: string; size: number}> {
	const agentRunner = deps.runAgent ?? runAgent;
	const themeSlug = loaded.config.themeSlug!;

	const codePath = join(loaded.dir, 'design', pull.slug, 'code.tsx');
	const code = await readFile(codePath, 'utf8');
	onEvent({
		kind: 'step',
		message: `Loaded design/${pull.slug}/code.tsx (${code.length} bytes)`,
	});

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
	} else {
		onEvent({kind: 'warn', message: 'No theme.json found — proceeding without it'});
	}

	const variablesPath = join(loaded.dir, 'variables', 'all-variables.json');
	const variablesText = await readIfExists(variablesPath);
	if (variablesText) {
		onEvent({
			kind: 'step',
			message: `Loaded variables/all-variables.json (${variablesText.length} bytes)`,
		});
	} else {
		onEvent({
			kind: 'warn',
			message: 'No variables/all-variables.json — proceeding without it',
		});
	}

	const baseSections: string[] = ['=== code.tsx ===', code];
	if (themeJsonText) {
		baseSections.push('', '=== theme.json ===', themeJsonText);
	}
	if (variablesText) {
		baseSections.push('', '=== variables.json ===', variablesText);
	}
	const devAnnotations = extractDevAnnotations(code);
	if (devAnnotations.length > 0) {
		const noteCount = devAnnotations.reduce(
			(sum, a) => sum + a.notes.length,
			0,
		);
		baseSections.push(
			'',
			'=== dev annotations ===',
			formatDevAnnotationsSection(devAnnotations),
		);
		onEvent({
			kind: 'step',
			message: `Captured ${noteCount} dev annotation${noteCount === 1 ? '' : 's'} on ${devAnnotations.length} node${devAnnotations.length === 1 ? '' : 's'}`,
		});
	}
	const placeholder = loaded.config.placeholderImage;
	if (placeholder) {
		baseSections.push('', '=== placeholder image ===', placeholderInstructions(placeholder));
	}
	const baseContext = baseSections.join('\n');

	const screenshotPath = join(
		loaded.dir,
		'design',
		pull.slug,
		'screenshot.png',
	);
	const screenshotBuf = await readBufferIfExists(screenshotPath);
	if (screenshotBuf) {
		onEvent({
			kind: 'step',
			message: `Loaded screenshot.png (${screenshotBuf.length} bytes)`,
		});
	} else {
		onEvent({
			kind: 'warn',
			message: 'No screenshot.png — proceeding without visual reference',
		});
	}
	const screenshotBase64 = screenshotBuf
		? screenshotBuf.toString('base64')
		: null;

	const userContent = buildUserContent(
		pull.templateFile,
		baseContext,
		screenshotBase64,
		pull.usesPostContent === true,
	);

	onEvent({kind: 'step', message: 'Invoking Claude Agent SDK…'});

	const responseText = await agentRunner(
		userContent,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	const envelope = parseBuildEnvelope(responseText, 'build-template');
	const target = templateTargetFor(pull.templateFile, pull.pageName);
	const out = envelope.template_html.endsWith('\n')
		? envelope.template_html
		: envelope.template_html + '\n';

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themePath = resolve(wpRoot, 'wp-content', 'themes', themeSlug);
	const session = await openStudioSession({signal});
	let cacheNeedsFlush = false;
	try {
		await writeTemplate(session, wpRoot, target, out);
		if (envelope.theme_json_patch) {
			const patchResult = await applyThemeJsonPatch(
				themeJsonPath,
				envelope.theme_json_patch,
			);
			if (patchResult.wrote) {
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

	const label = targetLabel(target);
	onEvent({
		kind: 'success',
		message: `Wrote ${out.length} bytes to ${label}`,
	});

	return {path: label, size: out.length};
}

type UserContent = Array<TextBlock | ImageBlock>;

// We rely on the tsx-to-blocks skill to know HOW to convert. The lead
// sentence keeps the trigger words from the skill's description so the
// SDK auto-invokes it; the skill body owns the conversion rules. The
// per-call dynamic context is the template's role (header/footer/page),
// which the skill cannot infer from code.tsx alone.
function buildUserContent(
	templateFile: string,
	baseContext: string,
	screenshotBase64: string | null,
	usesPostContent: boolean,
): UserContent {
	const role = templateRole(templateFile);
	const content: UserContent = [];

	const wrapperNote = usesPostContent
		? ' This template embeds the page body via wp:post-content. The TSX has a region marked with data-neptune-annotations="post-content" — replace that subtree with `<!-- wp:post-content /-->` and convert ONLY the surrounding chrome (post title, post date, comments, etc.). Do NOT convert the marked subtree itself; build-content will handle it.'
		: '';

	content.push({
		type: 'text',
		text:
			`Convert this Figma-generated React + Tailwind component (code.tsx) to Gutenberg block markup for the WordPress block theme template ${templateFile} (role: ${role}). Use the tsx-to-blocks skill. ${roleScopeNote(role)}${wrapperNote}`,
	});

	if (screenshotBase64) {
		content.push({
			type: 'text',
			text: '=== screenshot.png — visual reference for the intended design output ===',
		});
		content.push({
			type: 'image',
			source: {
				type: 'base64',
				media_type: 'image/png',
				data: screenshotBase64,
			},
		});
	}

	content.push({type: 'text', text: baseContext});

	return content;
}

// Instructions appended to the agent prompt when a placeholder image
// has been registered. Both the build and refine flows share this so
// the rule is identical in both contexts.
export function placeholderInstructions(placeholder: {
	id: number;
	url: string;
}): string {
	return [
		`A placeholder image is uploaded to the WordPress media library.`,
		`Use it for EVERY wp:image block you emit:`,
		`  - Block attrs: {"id":${placeholder.id}}`,
		`  - <img> src: ${placeholder.url}`,
		`  - <img> class includes: wp-image-${placeholder.id}`,
		`Never leave src empty and never invent a different URL.`,
	].join('\n');
}

export function roleScopeNote(role: TemplateRole): string {
	if (role === 'header') {
		return 'Convert ONLY the header region of the source page (site title, primary nav, top bar). Ignore main content and footer.';
	}
	if (role === 'footer') {
		return 'Convert ONLY the footer region of the source page (site info, secondary nav, copyright). Ignore header and main content.';
	}
	return 'Convert ONLY the main content region of the source page. Header and footer are rendered separately by parts/header.html and parts/footer.html — skip them.';
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
