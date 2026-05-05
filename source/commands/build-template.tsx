// Picks one non-special pull, feeds its design/<slug>/code.tsx (plus the
// theme's theme.json and variables/all-variables.json when present) to the
// Claude Agent SDK with the tsx-to-blocks skill, and writes the resulting
// Gutenberg block markup to the pull's templateFile in the WordPress theme.
//
// Modeled on build-theme-json.tsx: confirm-overwrite gate when the
// destination is non-empty so the user doesn't lose hand edits and doesn't
// pay for a regen they didn't intend.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {access, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	runAgent,
	type ContentBlock,
	type ImageBlock,
	type TextBlock,
} from '../lib/agent-stream.js';
import {listPulls} from '../lib/design-walk.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {templateRole, templateSubdir, type TemplateRole} from '../lib/template-scaffold.js';
import type {Loaded, PullMeta} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type PickablePull = PullMeta & {templateFile: string};

type Phase =
	| {kind: 'loading'}
	| {kind: 'picking'; pulls: PickablePull[]}
	| {kind: 'confirm'; pull: PickablePull; targetPath: string}
	| {kind: 'running'; pull: PickablePull}
	| {kind: 'success'; resultPath: string; size: number}
	| {kind: 'error'; error: string}
	| {kind: 'message'; title: string; subtitle?: string};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

export default function BuildTemplate({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [events, setEvents] = useState<LogEvent[]>([]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const pulls = await listPulls(activeProject.dir);
				if (cancelled) return;
				const pickable = pulls.filter(
					(p): p is PickablePull =>
						p.special === undefined &&
						typeof p.templateFile === 'string' &&
						p.templateFile.length > 0,
				);
				if (pickable.length === 0) {
					setPhase({
						kind: 'message',
						title: 'No pulls available to build a template from.',
						subtitle:
							'Pull a non-special template with a templateFile first.',
					});
					return;
				}
				setPhase({kind: 'picking', pulls: pickable});
			} catch (err) {
				if (cancelled) return;
				setPhase({
					kind: 'message',
					title: 'Could not load pulls.',
					subtitle: err instanceof Error ? err.message : String(err),
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [activeProject.dir]);

	const beginRun = (pull: PickablePull) => {
		setPhase({kind: 'running', pull});
		setEvents([]);
		(async () => {
			try {
				const result = await runBuild(activeProject, pull, ev =>
					setEvents(prev => [...prev, ev]),
				);
				setPhase({
					kind: 'success',
					resultPath: result.path,
					size: result.size,
				});
			} catch (err) {
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
		const targetPath = templatePath(
			activeProject.dir,
			themeSlug,
			pull.templateFile,
		);
		if (await fileHasContent(targetPath)) {
			setPhase({kind: 'confirm', pull, targetPath});
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
					<SelectInput
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
				targetPath={phase.targetPath}
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
	targetPath,
	onProceed,
	onCancel,
}: {
	targetPath: string;
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
					Template file already exists.
				</Text>
				<Text dimColor>{targetPath}</Text>
				<Box marginTop={1}>
					<Text>
						Running the build will overwrite this file and consume a paid
						Claude Agent SDK call.
					</Text>
				</Box>
			</Box>
			<Box marginTop={1}>
				<SelectInput
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

async function runBuild(
	loaded: Loaded,
	pull: PickablePull,
	onEvent: (ev: LogEvent) => void,
): Promise<{path: string; size: number}> {
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
	);

	onEvent({kind: 'step', message: 'Invoking Claude Agent SDK…'});

	const markup = await generateMarkup(loaded.dir, userContent, onEvent);

	const target = templatePath(loaded.dir, themeSlug, pull.templateFile);
	await mkdir(dirname(target), {recursive: true});
	const out = markup.endsWith('\n') ? markup : markup + '\n';
	await writeFile(target, out);

	onEvent({
		kind: 'success',
		message: `Wrote ${out.length} bytes to ${target}`,
	});

	return {path: target, size: out.length};
}

type UserContent = Array<TextBlock | ImageBlock>;

function buildUserContent(
	templateFile: string,
	baseContext: string,
	screenshotBase64: string | null,
): UserContent {
	const role = templateRole(templateFile);
	const content: UserContent = [];

	content.push({
		type: 'text',
		text: scopeInstruction(role, templateFile),
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

function scopeInstruction(role: TemplateRole, templateFile: string): string {
	const base = `Convert this React + Tailwind component into Gutenberg block markup for the template file ${templateFile}. Output raw block markup only, per the tsx-to-blocks skill.`;
	if (role === 'header') {
		return `${base}\n\nScope: this is a HEADER template part (parts/header.html). The code.tsx is a full page that typically contains header, main content, and footer. Extract ONLY the header region (e.g. site title, primary navigation, top bar) and convert that. Ignore the main content and footer entirely.`;
	}
	if (role === 'footer') {
		return `${base}\n\nScope: this is a FOOTER template part (parts/footer.html). The code.tsx is a full page that typically contains header, main content, and footer. Extract ONLY the footer region (e.g. site info, secondary nav, copyright) and convert that. Ignore the header and main content entirely.`;
	}
	return `${base}\n\nScope: this is a PAGE-level template (templates/${templateFile}). The code.tsx is a full page that typically contains header, main content, and footer. The header and footer are rendered separately by parts/header.html and parts/footer.html, so SKIP them here and convert ONLY the main content region between them.`;
}

async function generateMarkup(
	cwd: string,
	userContent: ContentBlock[],
	onEvent: (ev: LogEvent) => void,
): Promise<string> {
	const cleaned = await runAgent(
		userContent,
		{cwd, pluginPath: PLUGIN_PATH},
		onEvent,
	);
	if (!cleaned.trimStart().startsWith('<!--')) {
		throw new Error(
			`Response does not start with block markup. First 200 chars:\n${cleaned.slice(0, 200)}`,
		);
	}
	return cleaned;
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

async function fileHasContent(p: string): Promise<boolean> {
	try {
		const s = await stat(p);
		return s.isFile() && s.size > 0;
	} catch {
		return false;
	}
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
