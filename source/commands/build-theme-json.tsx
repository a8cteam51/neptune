// First merges design/*/variables.json into variables/all-variables.json,
// then feeds that to the Claude Agent SDK with the neptune-tools plugin
// (which exposes a theme.json skill) and writes the result to
// wp-content/themes/<theme>/theme.json. Streams progress events throughout.
//
// If theme.json already exists, gates the run behind a confirmation prompt
// so the user doesn't accidentally pay for the Claude call to overwrite a
// file they want to keep.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {access, readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAgent} from '../lib/agent-stream.js';
import {buildVariables} from '../lib/build-variables.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {markVariablesBuilt} from './setup-project/config.js';
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

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const themeSlug = activeProject.config.themeSlug;
			if (!themeSlug) {
				if (!cancelled) {
					setPhase({
						kind: 'error',
						error: 'themeSlug missing from neptune-config.',
					});
				}
				return;
			}
			const targetPath = themeJsonPath(activeProject.dir, themeSlug);
			if (await fileExists(targetPath)) {
				if (!cancelled) setPhase({kind: 'confirm', targetPath});
			} else {
				if (!cancelled) startBuild();
			}
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const startBuild = () => {
		setPhase({kind: 'running'});
		let cancelled = false;
		(async () => {
			try {
				const result = await buildThemeJson(activeProject, ev => {
					if (!cancelled) setEvents(prev => [...prev, ev]);
				});
				if (!cancelled) setPhase({kind: 'success', resultPath: result.path});
			} catch (err) {
				if (!cancelled) {
					setPhase({
						kind: 'error',
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}
		})();
	};

	useInput(
		() => {
			onDone();
		},
		{
			isActive:
				phase.kind === 'success' || phase.kind === 'error',
		},
	);

	if (phase.kind === 'checking') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build theme.json</Text>
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
			<Text bold color="cyan">Build theme.json</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{phase.kind === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>✓ theme.json written.</Text>
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
		{key: 'cancel', label: 'Cancel — keep existing theme.json', value: 'cancel'},
		{
			key: 'proceed',
			label: 'Overwrite and run the build',
			value: 'proceed',
		},
	];

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Build theme.json</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color="yellow" bold>theme.json already exists.</Text>
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

async function buildThemeJson(
	loaded: Loaded,
	onEvent: (ev: LogEvent) => void,
): Promise<{path: string; size: number}> {
	const themeSlug = loaded.config.themeSlug;
	if (!themeSlug) {
		throw new Error('themeSlug missing from neptune-config.');
	}

	onEvent({kind: 'step', message: 'Building variables…'});
	for await (const ev of buildVariables(loaded.dir)) {
		onEvent(ev);
	}
	await markVariablesBuilt(loaded.configPath);

	const variablesPath = join(loaded.dir, 'variables', 'all-variables.json');
	const variablesText = await readFile(variablesPath, 'utf8');
	onEvent({
		kind: 'step',
		message: `Loaded variables/all-variables.json (${variablesText.length} bytes)`,
	});

	onEvent({
		kind: 'step',
		message: `Loading plugin from ${PLUGIN_PATH}`,
	});

	const prompt =
		`Build a theme.json from these design variables:\n\n` +
		`${variablesText}`;

	onEvent({kind: 'step', message: 'Invoking Claude Agent SDK…'});

	const cleaned = await runAgent(
		prompt,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH},
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

	const target = themeJsonPath(loaded.dir, themeSlug);
	await mkdir(dirname(target), {recursive: true});
	const formatted = JSON.stringify(parsed, null, 2) + '\n';
	await writeFile(target, formatted);

	onEvent({
		kind: 'step',
		message: `Wrote ${formatted.length} bytes to theme.json`,
	});

	return {path: target, size: formatted.length};
}
