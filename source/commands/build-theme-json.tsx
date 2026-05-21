// First merges design/*/variables.json into variables/all-variables.json,
// then feeds that to the agent with the theme-json + pull-writer skills
// loaded. The agent computes the theme.json content AND writes it
// itself via the Write tool, then calls Haydi's wp_cache_flush via
// Recipe 5 if haydi is configured. The host post-flight reads the
// written file back, validates the shape, and surfaces a warning if
// settings.layout widths came out empty.
//
// If theme.json already exists, gates the run behind a confirmation prompt
// so the user doesn't accidentally pay for the Claude call to overwrite a
// file they want to keep.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../lib/menu.js';
import {access, mkdir, readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AgentAbortedError, runAgent} from '../lib/agent-stream.js';
import {buildVariables} from '../lib/build-variables.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {markVariablesBuilt} from './setup-project/config.js';
import {HAYDI_TOOL_ALLOWLIST, haydiMcpServers} from '../lib/haydi-mcp.js';
import {preflight} from '../integrations/haydi/client.js';
import {inspectLayoutWidths} from '../lib/theme-json-patch.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Phase =
	| {kind: 'checking'}
	| {kind: 'confirm'; targetPath: string}
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
			if (await fileExists(targetPath)) {
				if (!controller.signal.aborted) setPhase({kind: 'confirm', targetPath});
			} else {
				if (!controller.signal.aborted) startBuild();
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

	const startBuild = () => {
		setPhase({kind: 'running'});
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			try {
				const result = await buildThemeJson(
					activeProject,
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
				onProceed={startBuild}
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
						provider call.
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

export type BuildThemeJsonDeps = {
	runAgent?: typeof runAgent;
};

export async function buildThemeJson(
	loaded: Loaded,
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
	const variablesText = await readFile(variablesPath, 'utf8');
	onEvent({
		kind: 'step',
		message: `Loaded variables/all-variables.json (${variablesText.length} bytes)`,
	});

	const target = themeJsonPath(loaded.dir, themeSlug);
	await mkdir(dirname(target), {recursive: true});

	// Haydi attachment is optional for this command — the cache flush
	// at the end is the only Haydi call, and theme.json builds are
	// useful pre-Studio too (e.g. previewing variables before standing
	// up a site). When haydi is configured we attach + preflight; the
	// agent sees the tool and runs Recipe 5. When not, the agent skips
	// the flush per the skill's "if Haydi is configured" clause.
	const haydi = loaded.config.haydi;
	let haydiConfigured = false;
	if (haydi?.token) {
		try {
			onEvent({kind: 'step', message: `Pinging Haydi at ${haydi.url}…`});
			await preflight(haydi, signal);
			onEvent({kind: 'step', message: 'Haydi extensions verified'});
			haydiConfigured = true;
		} catch (err) {
			// Don't block the build on a pre-flight failure; just skip
			// the flush instructions and let the next request clear the
			// cache organically.
			onEvent({
				kind: 'warn',
				message: `Haydi pre-flight failed (${err instanceof Error ? err.message : String(err)}). Skipping cache flush — the next request will clear it.`,
			});
		}
	} else {
		onEvent({
			kind: 'warn',
			message:
				'haydi config absent — skipping cache flush. theme.json will still write to disk.',
		});
	}

	const prompt =
		`Build a WordPress theme.json (block theme, schema version 3) from the flat JSON object of design tokens below. Use the theme-json skill.\n\n` +
		`Persistence:\n` +
		`  - Write the theme.json to: ${target}\n` +
		`  - ${haydiConfigured ? 'Haydi IS configured for this run — call pull-writer Recipe 5 (wp_cache_flush via mcp__haydi__haydi_run_php) ONCE after the write.' : 'Haydi is NOT configured for this run — skip the cache flush. Just write the file.'}\n\n` +
		`Final response: one terse "wrote ..." summary line${haydiConfigured ? ' plus one "flushed theme.json cache" line' : ''}. No JSON, no fences, no commentary.\n\n` +
		`=== variables.json ===\n${variablesText}`;

	onEvent({kind: 'step', message: 'Invoking agent (writes theme.json)…'});

	const finalText = await agentRunner(
		prompt,
		{
			cwd: loaded.dir,
			pluginPath: PLUGIN_PATH,
			signal,
			...(haydiConfigured
				? {
						mcpServers: haydiMcpServers(haydi!),
						allowedTools: ['Read', 'Write', 'Glob', ...HAYDI_TOOL_ALLOWLIST],
					}
				: {allowedTools: ['Read', 'Write', 'Glob']}),
			maxTurns: 15,
		},
		onEvent,
	);

	// Post-flight: read the file back, validate the shape. Agent
	// claimed it wrote; verify.
	let writtenText: string;
	try {
		writtenText = await readFile(target, 'utf8');
	} catch (err) {
		throw new Error(
			`Agent finished but ${target} doesn't exist or isn't readable: ${err instanceof Error ? err.message : String(err)}\n\nAgent's final message (first 500 chars): ${finalText.slice(0, 500)}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(writtenText);
	} catch (err) {
		throw new Error(
			`Agent wrote ${target} but it isn't valid JSON: ${err instanceof Error ? err.message : String(err)}\n\nFirst 500 chars: ${writtenText.slice(0, 500)}`,
		);
	}
	if (!isValidThemeJson(parsed)) {
		throw new Error(
			`Agent wrote ${target} but the JSON is not a valid theme.json (need version 3 + settings).\n\nFirst 500 chars: ${writtenText.slice(0, 500)}`,
		);
	}

	onEvent({
		kind: 'step',
		message: `Verified theme.json at ${target} (${writtenText.length} bytes)`,
	});

	// Surface unset content/wide widths immediately so the user can fill
	// them in before any pull/build downstream tries to resolve
	// `align:"wide"` / no-align against an empty value. The agent leaves
	// these blank whenever Figma's tokens don't expose body / wide
	// widths, which is common.
	const widths = await inspectLayoutWidths(target);
	if (widths.contentSizeMissing || widths.wideSizeMissing) {
		const missing = [
			widths.contentSizeMissing ? 'contentSize' : null,
			widths.wideSizeMissing ? 'wideSize' : null,
		]
			.filter(Boolean)
			.join(' / ');
		onEvent({
			kind: 'warn',
			message: `theme.json settings.layout.${missing} is unset. Build/refine agents rely on these to resolve align:"wide" and the default content width — fill them in before pulling pages so blocks center correctly.`,
		});
	}

	return {path: target, size: writtenText.length};
}

function isValidThemeJson(parsed: unknown): boolean {
	if (typeof parsed !== 'object' || parsed === null) return false;
	const o = parsed as Record<string, unknown>;
	if (o['version'] !== 3) return false;
	if (typeof o['settings'] !== 'object' || o['settings'] === null) return false;
	return true;
}
