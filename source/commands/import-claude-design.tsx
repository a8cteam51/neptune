// Import Claude Design UI shell. Walks the user through: pick the package
// folder → validate (show counts + warnings) → confirm widths → run the
// import (paid standardize agent + install) → summary. The heavy lifting
// is in import-claude-design.ts (runImport).
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import Menu from '../lib/menu.js';
import TextStep, {type ValidatorResult} from '../lib/text-step.js';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {AgentAbortedError} from '../lib/agent-stream.js';
import {
	readExistingLayoutWidths,
	validateLayoutLength,
	type LayoutWidths,
} from './build-theme-json.js';
import {
	validateClaudeDesignDir,
	type ValidationResult,
} from '../integrations/claude-design/contract.js';
import {
	runImport,
	type ImportResult,
} from '../integrations/claude-design/import.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: (refresh?: boolean) => void;
};

type Phase =
	| {kind: 'pick'; initial: string}
	| {kind: 'validating'; dir: string}
	| {
			kind: 'confirm';
			dir: string;
			validation: ValidationResult;
			defaults: LayoutWidths;
	  }
	| {kind: 'widthsContent'; dir: string; defaults: LayoutWidths}
	| {
			kind: 'widthsWide';
			dir: string;
			contentSize: string;
			defaults: LayoutWidths;
	  }
	| {kind: 'running'}
	| {kind: 'done'; result: ImportResult}
	| {kind: 'error'; error: string};

function expandTilde(p: string): string {
	const trimmed = p.trim();
	if (trimmed === '~') return homedir();
	if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2));
	return resolve(trimmed);
}

function validateDirInput(raw: string): ValidatorResult {
	if (raw.trim() === '') {
		return {
			ok: false,
			error: 'Enter the path to a Claude Design package folder.',
		};
	}
	return {ok: true, value: expandTilde(raw)};
}

export default function ImportClaudeDesign({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({
		kind: 'pick',
		initial: activeProject.config.claudeDesign?.sourceDir ?? '',
	});
	const [events, setEvents] = useState<LogEvent[]>([]);
	const runControllerRef = useRef<AbortController | null>(null);

	useEffect(
		() => () => {
			runControllerRef.current?.abort();
		},
		[],
	);

	const validatePackage = (dir: string) => {
		setPhase({kind: 'validating', dir});
		(async () => {
			try {
				const validation = await validateClaudeDesignDir(dir);
				const defaults = await readExistingLayoutWidths(
					resolve(dir, 'theme.json'),
				);
				setPhase({kind: 'confirm', dir, validation, defaults});
			} catch (err) {
				setPhase({
					kind: 'error',
					error: err instanceof Error ? err.message : String(err),
				});
			}
		})();
	};

	const startImport = (dir: string, widths: LayoutWidths) => {
		setPhase({kind: 'running'});
		setEvents([]);
		const controller = new AbortController();
		runControllerRef.current?.abort();
		runControllerRef.current = controller;
		(async () => {
			try {
				const result = await runImport(
					activeProject,
					dir,
					widths,
					controller.signal,
					ev => {
						if (!controller.signal.aborted) setEvents(prev => [...prev, ev]);
					},
				);
				if (controller.signal.aborted) return;
				setPhase({kind: 'done', result});
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

	useInput(() => onDone(phase.kind === 'done'), {
		isActive: phase.kind === 'done' || phase.kind === 'error',
	});

	if (phase.kind === 'pick') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Import Claude Design
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>
						Point Neptune at a Claude Design package folder (the directory with
						theme.json, templates/, parts/, style.css and the static reference
						pages). Neptune standardizes it into theme.json + block styles,
						installs it, and sets up the refine targets.
					</Text>
				</Box>
				<Box marginTop={1}>
					<TextStep
						title=""
						hint="Enter to confirm. Tilde (~) is expanded."
						placeholder="~/Desktop/my-design"
						initialValue={phase.initial}
						validate={validateDirInput}
						onSubmit={validatePackage}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'validating') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Import Claude Design
				</Text>
				<Text dimColor>Validating package…</Text>
			</Box>
		);
	}

	if (phase.kind === 'confirm') {
		const v = phase.validation;
		if (!v.ok || !v.manifest) {
			return (
				<Box flexDirection="column" padding={1}>
					<Text bold color="cyan">
						Import Claude Design
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Text color="red" bold>
							Package is not valid.
						</Text>
						{v.errors.map((e, i) => (
							<Text key={i} color="red">
								• {e}
							</Text>
						))}
					</Box>
					<Box marginTop={1}>
						<Menu
							items={[{key: 'back', label: 'Back', value: 'back'}]}
							onSelect={() => setPhase({kind: 'pick', initial: phase.dir})}
						/>
					</Box>
				</Box>
			);
		}
		const m = v.manifest;
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Import Claude Design
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>
						<Text bold>{m.templates.length}</Text> template(s),{' '}
						<Text bold>{m.parts.length}</Text> part(s),{' '}
						<Text bold>{Object.keys(m.staticRefs).length}</Text> refine
						target(s), style.css {m.styleCssPath ? 'present' : 'absent'}.
					</Text>
					{v.warnings.length > 0 ? (
						<Box marginTop={1} flexDirection="column">
							<Text color="yellow" bold>
								{v.warnings.length} warning(s):
							</Text>
							{v.warnings.map((w, i) => (
								<Text key={i} color="yellow">
									! {w}
								</Text>
							))}
						</Box>
					) : null}
					<Box marginTop={1}>
						<Text>
							Importing runs a paid standardize agent and overwrites this
							project&apos;s theme ({activeProject.config.themeSlug}). The
							Studio site must be running.
						</Text>
					</Box>
				</Box>
				<Box marginTop={1}>
					<Menu
						items={[
							{key: 'cancel', label: 'Cancel', value: 'cancel'},
							{
								key: 'proceed',
								label: 'Set layout widths and import',
								value: 'proceed',
							},
						]}
						onSelect={item => {
							if (item.value === 'proceed') {
								setPhase({
									kind: 'widthsContent',
									dir: phase.dir,
									defaults: phase.defaults,
								});
							} else {
								onDone(false);
							}
						}}
					/>
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'widthsContent') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Import Claude Design
				</Text>
				<Box marginTop={1}>
					<Text dimColor>
						Confirm the theme&apos;s content / wide widths (pre-filled from the
						package theme.json). These drive how blocks resolve
						align:&quot;wide&quot;.
					</Text>
				</Box>
				<Box marginTop={1}>
					<TextStep
						title="Content size (default content width)"
						hint="CSS length, e.g. 640px. Submit empty to keep the package value."
						placeholder="640px"
						initialValue={phase.defaults.contentSize}
						validate={validateLayoutLength}
						onSubmit={value =>
							setPhase({
								kind: 'widthsWide',
								dir: phase.dir,
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
					Import Claude Design
				</Text>
				<Box marginTop={1}>
					<TextStep
						title="Wide size (wide-alignment width)"
						hint='CSS length used for align:"wide". Submit empty to keep the package value.'
						placeholder="1100px"
						initialValue={phase.defaults.wideSize}
						validate={validateLayoutLength}
						onSubmit={value =>
							startImport(phase.dir, {
								contentSize: phase.contentSize,
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
					Import Claude Design
				</Text>
				<Box marginTop={1}>
					<EventList events={events} status="running" />
				</Box>
			</Box>
		);
	}

	if (phase.kind === 'error') {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					Import Claude Design
				</Text>
				<Box marginTop={1}>
					<EventList events={events} status="error" />
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>
						✗ Import failed.
					</Text>
					<Text color="red">{phase.error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			</Box>
		);
	}

	// done
	const r = phase.result;
	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">
				Import Claude Design
			</Text>
			<Box marginTop={1}>
				<EventList events={events} status="success" />
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text color="green" bold>
					✓ Imported. {r.templatesInstalled} template(s), {r.partsInstalled}{' '}
					part(s) installed.
				</Text>
				<Text>
					Standardized: {r.reclassifiedCount} rule(s) reclassified,{' '}
					{r.variationsWritten} block style variation(s),{' '}
					{r.residualWritten ? 'residual style.css written' : 'style.css kept'},{' '}
					{r.keptCount} rule(s) kept as CSS.
				</Text>
				{r.invalidBlockFiles.length > 0 ? (
					<Text color="yellow">
						! {r.invalidBlockFiles.length} file(s) had block-validation issues:{' '}
						{r.invalidBlockFiles.join(', ')}
					</Text>
				) : null}
				<Text>
					Refine targets:{' '}
					{r.refineTargets.map(t => t.slug).join(', ') || 'none'}. Run “Refine
					templates” to polish against the design.
				</Text>
				<Text dimColor>Press any key to return.</Text>
			</Box>
		</Box>
	);
}
