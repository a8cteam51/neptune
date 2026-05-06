// Sequentially builds a user-chosen subset of patterns/<Name>/code.tsx
// files into WordPress block patterns at <theme>/patterns/<slug>.php. The
// picker starts with every pattern checked; the user toggles off the
// ones they don't want and presses Enter to run. No per-pattern
// confirm — the picker IS the confirmation.
//
// Each pattern is one paid Claude Agent SDK call against the
// tsx-to-pattern skill. The agent returns a JSON envelope with the
// pattern title/categories/keywords plus block markup; Neptune wraps
// the markup in a PHP file header WordPress core auto-registers at
// boot. theme.json patches and block style variations from the
// envelope are applied the same way the build-template flow handles
// them.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {access, readFile, stat} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	AgentAbortedError,
	runAgent,
	type ImageBlock,
	type TextBlock,
} from '../lib/agent-stream.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import MultiSelect from '../lib/multi-select.js';
import {
	applyBlockStyleVariations,
	applyThemeJsonPatch,
	flushThemeJsonCache,
	formatBlockStyleVariationsContext,
	readBlockStyleVariations,
} from '../lib/theme-json-patch.js';
import {
	kebabFromPascalCase,
	listPatternSources,
	parsePatternEnvelope,
	serializePatternPhp,
	writePatternFile,
	type PatternSource,
} from '../lib/patterns.js';
import {placeholderInstructions} from './build-template.js';
import {openStudioSession} from '../integrations/studio/mcp.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: () => void;
};

type Outcome =
	| {kind: 'ok'; name: string; slug: string; path: string; size: number}
	| {kind: 'err'; name: string; error: string};

type Phase =
	| {kind: 'loading'}
	| {kind: 'picking'; sources: PatternSource[]}
	| {kind: 'running'; sources: PatternSource[]; cursor: number}
	| {kind: 'done'; outcomes: Outcome[]}
	| {kind: 'message'; title: string; subtitle?: string};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const PLUGIN_PATH = resolve(moduleDir, '..', '..', 'plugins', 'neptune-tools');

export default function BuildPatterns({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [events, setEvents] = useState<LogEvent[]>([]);
	const outcomesRef = useRef<Outcome[]>([]);
	const runControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		(async () => {
			try {
				if (!activeProject.config.themeSlug) {
					setPhase({
						kind: 'message',
						title: 'themeSlug missing from neptune-config.json.',
						subtitle: 'Finish theme setup first.',
					});
					return;
				}
				const sources = await listPatternSources(activeProject.dir);
				if (controller.signal.aborted) return;
				if (sources.length === 0) {
					setPhase({
						kind: 'message',
						title: 'No patterns/*/code.tsx found.',
						subtitle: 'Run Extract patterns first.',
					});
					return;
				}
				setPhase({kind: 'picking', sources});
			} catch (err) {
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'message',
					title: 'Could not load pattern sources.',
					subtitle: err instanceof Error ? err.message : String(err),
				});
			}
		})();
		return () => controller.abort();
	}, [activeProject.config.themeSlug, activeProject.dir]);

	useEffect(
		() => () => {
			runControllerRef.current?.abort();
		},
		[],
	);

	const beginRun = (sources: PatternSource[]) => {
		setPhase({kind: 'running', sources, cursor: 0});
		setEvents([]);
		outcomesRef.current = [];
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			for (let i = 0; i < sources.length; i++) {
				if (controller.signal.aborted) return;
				const src = sources[i]!;
				setPhase({kind: 'running', sources, cursor: i});
				setEvents(prev => [
					...prev,
					{
						kind: 'step',
						message: `[${i + 1}/${sources.length}] ${src.name}`,
					},
				]);
				try {
					const result = await runBuildPattern(
						activeProject,
						src,
						controller.signal,
						ev => {
							if (!controller.signal.aborted) {
								setEvents(prev => [...prev, ev]);
							}
						},
					);
					outcomesRef.current.push({
						kind: 'ok',
						name: src.name,
						slug: result.slug,
						path: result.path,
						size: result.size,
					});
				} catch (err) {
					if (controller.signal.aborted) return;
					if (err instanceof AgentAbortedError) return;
					const msg = err instanceof Error ? err.message : String(err);
					outcomesRef.current.push({
						kind: 'err',
						name: src.name,
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
			if (phase.kind === 'picking' && key.escape) onDone();
		},
		{
			isActive:
				phase.kind === 'message' ||
				phase.kind === 'done' ||
				phase.kind === 'picking',
		},
	);

	if (phase.kind === 'loading') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build patterns</Text>
				<Box marginTop={1}>
					<Text dimColor>Loading patterns…</Text>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'message') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build patterns</Text>
				<Box marginTop={1}>
					<Text color="yellow" bold>{phase.title}</Text>
				</Box>
				{phase.subtitle ? <Text dimColor>{phase.subtitle}</Text> : null}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		);
	}

	if (phase.kind === 'picking') {
		const items = phase.sources.map(s => ({
			key: s.name,
			label: `${s.name} → patterns/${kebabFromPascalCase(s.name)}.php`,
			value: s,
		}));
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build patterns</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" bold>
						All {phase.sources.length} pattern{phase.sources.length === 1 ? '' : 's'} are selected by default.
					</Text>
					<Text>
						Toggle off any you don't want to build and press Enter. Each
						selected pattern is one paid Claude Agent SDK call. Existing
						pattern PHP files at the same slug will be overwritten.
					</Text>
				</Box>
				<Box marginTop={1}>
					<MultiSelect
						items={items}
						onSubmit={selected => {
							if (selected.length === 0) {
								onDone();
								return;
							}
							beginRun(selected);
						}}
						onCancel={onDone}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'running') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">Build patterns</Text>
				<Box marginTop={1}>
					<EventList events={events} status="running" />
				</Box>
			</Box>
		);
	}

	const ok = phase.outcomes.filter(o => o.kind === 'ok').length;
	const failed = phase.outcomes.filter(o => o.kind === 'err').length;
	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Build patterns</Text>
			<Box marginTop={1}>
				<EventList events={events} status={failed === 0 ? 'success' : 'error'} />
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text color={failed === 0 ? 'green' : 'yellow'} bold>
					{ok} succeeded, {failed} failed
				</Text>
				{phase.outcomes.map(o =>
					o.kind === 'ok' ? (
						<Text key={o.name} color="green">
							  ✓ {o.name} → {o.slug}.php ({o.size} bytes)
						</Text>
					) : (
						<Text key={o.name} color="red">
							  ✗ {o.name}: {o.error}
						</Text>
					),
				)}
				<Text dimColor>Press any key to return.</Text>
			</Box>
		</Box>
	);
}

export type BuildPatternDeps = {
	runAgent?: typeof runAgent;
};

export async function runBuildPattern(
	loaded: Loaded,
	src: PatternSource,
	signal: AbortSignal,
	onEvent: (ev: LogEvent) => void,
	deps: BuildPatternDeps = {},
): Promise<{slug: string; path: string; size: number}> {
	const agentRunner = deps.runAgent ?? runAgent;
	const themeSlug = loaded.config.themeSlug!;

	onEvent({
		kind: 'step',
		message: `Loaded patterns/${src.name}/code.tsx (${src.body.length} bytes)`,
	});

	const wpRoot = resolve(loaded.dir, 'wordpress');
	const themePath = resolve(wpRoot, 'wp-content', 'themes', themeSlug);
	const themeJsonPath = resolve(themePath, 'theme.json');

	const themeJsonText = await readIfExists(themeJsonPath);
	if (themeJsonText) {
		onEvent({
			kind: 'step',
			message: `Loaded theme.json (${themeJsonText.length} bytes)`,
		});
	} else {
		onEvent({
			kind: 'warn',
			message: 'No theme.json found — proceeding without it',
		});
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

	const existingVariations = await readBlockStyleVariations(themePath, msg =>
		onEvent({kind: 'warn', message: msg}),
	);
	const variationsContext = formatBlockStyleVariationsContext(
		existingVariations,
	);
	if (variationsContext) {
		onEvent({
			kind: 'step',
			message: `Loaded ${existingVariations.length} existing block style variation${existingVariations.length === 1 ? '' : 's'} for reuse context`,
		});
	}

	const sections: string[] = ['=== pattern.tsx ===', src.body];
	if (themeJsonText) {
		sections.push('', '=== theme.json ===', themeJsonText);
	}
	if (variablesText) {
		sections.push('', '=== variables.json ===', variablesText);
	}
	if (variationsContext) {
		sections.push(
			'',
			'=== existing block style variations ===',
			'These variations are already registered. Reuse them by adding the matching `is-style-<slug>` class to a block instead of redefining them. Only emit a new entry in `block_style_variations[]` when none of these fits.',
			variationsContext,
		);
	}
	const placeholder = loaded.config.placeholderImage;
	if (placeholder) {
		sections.push(
			'',
			'=== placeholder image ===',
			placeholderInstructions(placeholder),
		);
	}
	const baseContext = sections.join('\n');

	const screenshotPath = join(
		loaded.dir,
		'patterns',
		src.name,
		'screenshot.png',
	);
	const screenshotBuf = await readPngIfExists(screenshotPath);
	if (screenshotBuf) {
		onEvent({
			kind: 'step',
			message: `Loaded screenshot.png (${screenshotBuf.length} bytes)`,
		});
	} else {
		onEvent({
			kind: 'warn',
			message: 'No usable screenshot.png — proceeding without visual reference',
		});
	}
	const screenshotBase64 = screenshotBuf
		? screenshotBuf.toString('base64')
		: null;

	const userContent = buildUserContent(src.name, baseContext, screenshotBase64);

	onEvent({kind: 'step', message: 'Invoking Claude Agent SDK…'});

	const responseText = await agentRunner(
		userContent,
		{cwd: loaded.dir, pluginPath: PLUGIN_PATH, signal},
		onEvent,
	);

	const envelope = parsePatternEnvelope(responseText);
	const slug = kebabFromPascalCase(src.name);
	if (!slug) {
		throw new Error(
			`Cannot derive a kebab-case slug from pattern name "${src.name}".`,
		);
	}
	const php = serializePatternPhp({themeSlug, slug, envelope});
	const path = await writePatternFile(themePath, slug, php);

	const session = await openStudioSession({signal});
	let cacheNeedsFlush = false;
	try {
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

	onEvent({
		kind: 'success',
		message: `Wrote ${php.length} bytes to ${path}`,
	});

	return {slug, path, size: php.length};
}

type UserContent = Array<TextBlock | ImageBlock>;

// We rely on the tsx-to-pattern skill to know HOW to convert. The
// lead sentence keeps the trigger words from the skill's description
// so the SDK auto-invokes it; the skill body owns the conversion
// rules. The per-call dynamic context is the pattern's source name —
// the agent uses it as the canonical title fallback when the TSX
// doesn't suggest something better.
function buildUserContent(
	name: string,
	baseContext: string,
	screenshotBase64: string | null,
): UserContent {
	const content: UserContent = [
		{
			type: 'text',
			text:
				`Convert this Figma-extracted React + Tailwind pattern function (named "${name}") into a WordPress block pattern. ` +
				`Use the tsx-to-pattern skill. Treat the supplied TSX as a reusable fragment — patterns are not full pages. ` +
				`Return the JSON envelope described in the skill. Neptune wraps the markup in the PHP file header itself; ` +
				`do NOT emit any \`<?php\` tags or call any tools yourself.`,
		},
	];

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

// pull-pattern always writes a screenshot.png alongside code.tsx, but
// extract-patterns under the previous flow may have left zero-byte
// placeholders behind. A zero-byte file is "exists" but not a usable
// PNG, so treat it the same as missing.
async function readPngIfExists(p: string): Promise<Buffer | null> {
	try {
		const s = await stat(p);
		if (!s.isFile() || s.size === 0) return null;
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
