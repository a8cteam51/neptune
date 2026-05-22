// First merges design/*/variables.json into variables/all-variables.json,
// then feeds that to the Claude agent with the theme-json skill
// (which exposes a theme-json skill) and writes the result to
// wp-content/themes/<theme>/theme.json. Streams progress events throughout.
//
// If theme.json already exists, gates the run behind a confirmation prompt
// so the user doesn't accidentally pay for the Claude call to overwrite a
// file they want to keep.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../lib/menu.js';
import TextStep from '../lib/text-step.js';
import {access, readFile, mkdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileAtomic} from '../lib/atomic-write.js';
import {AgentAbortedError, runAgent} from '../lib/agent-stream.js';
import {buildVariables} from '../lib/build-variables.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {markVariablesBuilt} from './setup-project/config.js';
import {openStudioSession} from '../integrations/studio/mcp.js';
import {
	flushThemeJsonCache,
	inspectLayoutWidths,
} from '../lib/theme-json-patch.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Phase =
	| {kind: 'checking'}
	| {kind: 'confirm'; targetPath: string; defaults: LayoutWidths}
	| {kind: 'widthsContent'; defaults: LayoutWidths}
	| {
			kind: 'widthsWide';
			contentSize: string;
			defaults: LayoutWidths;
	  }
	| {kind: 'running'}
	| {kind: 'success'; resultPath: string}
	| {kind: 'error'; error: string};

// dist/commands/build-theme-json.js → ../../plugins/neptune-tools
const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

export default function BuildThemeJson({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'checking'});
	const [events, setEvents] = useState<LogEvent[]>([]);
	const runControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		(async () => {
			const themeSlug = activeProject.config.themeSlug;
			if (!themeSlug) {
				if (!controller.signal.aborted) {
					setPhase({
						kind: 'error',
						error: 'themeSlug missing from neptune-config.',
					});
				}
				return;
			}
			const targetPath = themeJsonPath(activeProject.dir, themeSlug);
			const defaults = await readExistingLayoutWidths(targetPath);
			if (controller.signal.aborted) return;
			if (await fileExists(targetPath)) {
				if (!controller.signal.aborted) {
					setPhase({kind: 'confirm', targetPath, defaults});
				}
			} else {
				if (!controller.signal.aborted) {
					setPhase({kind: 'widthsContent', defaults});
				}
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

	const startBuild = (widths: LayoutWidths) => {
		setPhase({kind: 'running'});
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			try {
				const result = await buildThemeJson(
					activeProject,
					widths,
					controller.signal,
					ev => {
						if (!controller.signal.aborted) {
							setEvents(prev => [...prev, ev]);
						}
					},
				);
				if (controller.signal.aborted) return;
				setPhase({kind: 'success', resultPath: result.path});
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
		() => {
			onDone();
		},
		{
			isActive: phase.kind === 'success' || phase.kind === 'error',
		},
	);

	if (phase.kind === 'checking') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Build theme.json
				</Text>
				<Text dimColor>Checking for existing theme.json…</Text>
			</Box>
		);
	}

	if (phase.kind === 'confirm') {
		return (
			<ConfirmOverwrite
				targetPath={phase.targetPath}
				onProceed={() =>
					setPhase({kind: 'widthsContent', defaults: phase.defaults})
				}
				onCancel={onDone}
			/>
		);
	}

	if (phase.kind === 'widthsContent') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Build theme.json
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>
						The theme&apos;s `settings.layout.contentSize` and `wideSize` drive
						how every block resolves `align:&quot;wide&quot;` and the default
						content width. Type these in now — Neptune injects them into
						variables/all-variables.json for the agent and enforces them on the
						final theme.json.
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
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Build theme.json
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text dimColor>
						contentSize = <Text bold>{phase.contentSize || '<empty>'}</Text>
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
							startBuild({contentSize: phase.contentSize, wideSize: value})
						}
					/>
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
			<Text bold color="cyan">
				Build theme.json
			</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{phase.kind === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>
						✓ theme.json written.
					</Text>
					<Text dimColor>{phase.resultPath}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
			{phase.kind === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>
						✗ Build failed.
					</Text>
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
			label: 'Cancel — keep existing theme.json',
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
			<Text bold color="cyan">
				Build theme.json
			</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color="yellow" bold>
					theme.json already exists.
				</Text>
				<Text dimColor>{targetPath}</Text>
				<Box marginTop={1}>
					<Text>
						Running the build will overwrite this file and consume a paid agent
						call.
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

function themeJsonPath(projectDir: string, themeSlug: string): string {
	return resolve(
		projectDir,
		'wordpress',
		'wp-content',
		'themes',
		themeSlug,
		'theme.json',
	);
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

// Reads existing settings.layout values from a theme.json on disk so
// the widths-input UI can pre-fill defaults. Returns empty strings for
// any value that is missing, blank, or unreadable — caller treats those
// as "user must type one in".
export async function readExistingLayoutWidths(
	themeJsonFilePath: string,
): Promise<LayoutWidths> {
	try {
		const raw = await readFile(themeJsonFilePath, 'utf8');
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return {contentSize: '', wideSize: ''};
		}
		const settings = (parsed as Record<string, unknown>)['settings'];
		const layout =
			typeof settings === 'object' &&
			settings !== null &&
			!Array.isArray(settings)
				? (settings as Record<string, unknown>)['layout']
				: undefined;
		const layoutObj =
			typeof layout === 'object' && layout !== null && !Array.isArray(layout)
				? (layout as Record<string, unknown>)
				: {};
		const cs = layoutObj['contentSize'];
		const ws = layoutObj['wideSize'];
		return {
			contentSize: typeof cs === 'string' && cs.trim() !== '' ? cs.trim() : '',
			wideSize: typeof ws === 'string' && ws.trim() !== '' ? ws.trim() : '',
		};
	} catch {
		return {contentSize: '', wideSize: ''};
	}
}

// Merges the user-supplied widths into variables/all-variables.json
// under reserved keys the theme-json skill recognises. Last-write-wins
// here is intentional — these keys are owned by Neptune, not Figma, so
// any existing entry under the same key (impossible in practice given
// the prefix) is overwritten.
async function injectLayoutWidths(
	variablesPath: string,
	widths: LayoutWidths,
): Promise<void> {
	const raw = await readFile(variablesPath, 'utf8');
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	parsed[LAYOUT_CONTENT_SIZE_KEY] = widths.contentSize;
	parsed[LAYOUT_WIDE_SIZE_KEY] = widths.wideSize;
	await writeFileAtomic(variablesPath, JSON.stringify(parsed, null, 2) + '\n');
}

// Writes the user-supplied widths into the parsed agent response,
// creating settings/layout subtrees if absent. Run AFTER the agent
// returns so the final on-disk theme.json carries exactly what the
// user typed, regardless of whether the agent honoured the reserved
// flat-map keys.
function enforceLayoutWidths(themeJson: unknown, widths: LayoutWidths): void {
	if (typeof themeJson !== 'object' || themeJson === null) return;
	const root = themeJson as Record<string, unknown>;
	const settings = ensurePlainObject(root, 'settings');
	const layout = ensurePlainObject(settings, 'layout');
	layout['contentSize'] = widths.contentSize;
	layout['wideSize'] = widths.wideSize;
}

function ensurePlainObject(
	host: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const existing = host[key];
	if (
		typeof existing === 'object' &&
		existing !== null &&
		!Array.isArray(existing)
	) {
		return existing as Record<string, unknown>;
	}
	const created: Record<string, unknown> = {};
	host[key] = created;
	return created;
}

// Loose CSS-length validator for the layout-widths prompts. Accepts
// empty (the user explicitly chose "leave unset") and any non-empty
// string that looks like a CSS length: digits + a known unit, a
// calc() / clamp() / min() / max() expression, or a CSS variable.
// We don't try to be exhaustive — invalid lengths get flagged when WP
// resolves them; the validator's job is to catch obvious typos
// (forgotten unit, stray letters) before the agent call.
export function validateLayoutLength(
	raw: string,
): {ok: true; value: string} | {ok: false; error: string} {
	const trimmed = raw.trim();
	if (trimmed === '') return {ok: true, value: ''};
	if (
		/^(?:calc|clamp|min|max|var)\(/.test(trimmed) ||
		/^[-+]?\d+(?:\.\d+)?(?:px|rem|em|%|vw|vh|svw|svh|lvw|lvh|dvw|dvh|ch)$/.test(
			trimmed,
		)
	) {
		return {ok: true, value: trimmed};
	}
	return {
		ok: false,
		error:
			'Enter a CSS length with a unit (780px, 60rem, 100%) or a calc()/clamp()/var() expression. Submit empty to leave unset.',
	};
}

export type BuildThemeJsonDeps = {
	runAgent?: typeof runAgent;
};

// Reserved flat-map keys used to thread the user-supplied content/wide
// widths through buildVariables → all-variables.json → the theme-json
// agent. Double-underscored to avoid collision with any token name
// Figma might emit. The theme-json skill is instructed to read these
// keys verbatim into settings.layout.contentSize / wideSize.
export const LAYOUT_CONTENT_SIZE_KEY = '__neptune__layout_content_size';
export const LAYOUT_WIDE_SIZE_KEY = '__neptune__layout_wide_size';

export type LayoutWidths = {
	contentSize: string;
	wideSize: string;
};

export async function buildThemeJson(
	loaded: Loaded,
	widths: LayoutWidths,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: BuildThemeJsonDeps = {},
): Promise<{path: string; size: number}> {
	const agentRunner = deps.runAgent ?? runAgent;
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error('themeSlug missing from neptune-config.');
	}

	onEvent({kind: 'step', message: 'Building variables…'});
	for await (const ev of buildVariables(loaded.dir)) {
		if (signal.aborted) throw new AgentAbortedError();
		onEvent(ev);
	}
	await markVariablesBuilt(loaded);

	const variablesPath = join(loaded.dir, 'variables', 'all-variables.json');
	await injectLayoutWidths(variablesPath, widths);
	const variablesText = await readFile(variablesPath, 'utf8');
	onEvent({
		kind: 'step',
		message: `Loaded variables/all-variables.json (${variablesText.length} bytes) with contentSize=${widths.contentSize || '<empty>'} wideSize=${widths.wideSize || '<empty>'}`,
	});

	onEvent({kind: 'step', message: 'Invoking Claude agent…'});

	// Lead sentence carries the trigger words from the theme-json skill's
	// description so the SDK auto-invokes it; the skill body owns the
	// mapping rules.
	const prompt =
		`Build a WordPress theme.json (block theme, schema version 3) from this flat JSON object of design tokens. Use the theme-json skill.\n\n` +
		variablesText;

	const cleaned = await agentRunner(
		prompt,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch (err) {
		throw new Error(
			`Response was not valid JSON: ${
				err instanceof Error ? err.message : String(err)
			}\n\nFirst 500 chars: ${cleaned.slice(0, 500)}`,
		);
	}
	if (!isValidThemeJson(parsed)) {
		throw new Error(
			'Response did not contain a valid theme.json (need version 3 + settings).',
		);
	}

	// Authoritative enforcement: the user-supplied widths win regardless
	// of what the agent emitted. The all-variables injection is a hint;
	// this guarantees the final theme.json carries the values the user
	// typed, even if the agent ignored or transformed them.
	enforceLayoutWidths(parsed, widths);

	const target = themeJsonPath(loaded.dir, themeSlug);
	await mkdir(dirname(target), {recursive: true});
	const formatted = JSON.stringify(parsed, null, 2) + '\n';
	await writeFileAtomic(target, formatted);

	onEvent({
		kind: 'step',
		message: `Wrote ${formatted.length} bytes to theme.json`,
	});

	// Defensive: even after enforcement, surface anything still missing
	// (e.g. user submitted empty strings). Downstream build/refine agents
	// resolve `align:"wide"` and the default content width against these
	// values; leaving them empty makes every page render at the browser
	// default.
	const status = await inspectLayoutWidths(target);
	if (status.contentSizeMissing || status.wideSizeMissing) {
		const missing = [
			status.contentSizeMissing ? 'contentSize' : null,
			status.wideSizeMissing ? 'wideSize' : null,
		]
			.filter(Boolean)
			.join(' / ');
		onEvent({
			kind: 'warn',
			message: `theme.json settings.layout.${missing} is unset. Re-run Build theme.json with non-empty values before pulling pages so blocks center correctly.`,
		});
	}

	// Flush WP's cached resolved theme.json so the live site picks up
	// the new presets on the next request. Mirrors the flush every other
	// theme.json writer (build-template/build-content/refine) does.
	const wpRoot = resolve(loaded.dir, 'wordpress');
	const session = await openStudioSession({signal});
	try {
		await flushThemeJsonCache(session, wpRoot);
	} finally {
		session.close();
	}

	return {path: target, size: formatted.length};
}

function isValidThemeJson(parsed: unknown): boolean {
	if (typeof parsed !== 'object' || parsed === null) return false;
	const o = parsed as Record<string, unknown>;
	if (o['version'] !== 3) return false;
	if (typeof o['settings'] !== 'object' || o['settings'] === null) return false;
	return true;
}
