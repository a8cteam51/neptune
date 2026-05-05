// Setup wizard entrypoint. Walks the user through pickFolder → loadOrInit
// → in-flow steps until nextPendingStep returns undefined, then lands on
// allDone. Each step's persistent state lives in neptune-config.json
// (steps[]); this component just orchestrates which step is current.
import React, {useEffect, useState} from 'react';
import {Text, useInput} from 'ink';
import FrameTitle from './frame.js';
import FolderPicker from './folder-picker.js';
import InFlow from './in-flow.js';
import {applyUpdate, loadOrInit} from './config.js';
import {nextPendingStep} from './steps-meta.js';
import type {Loaded} from './types.js';

type Props = {
	onDone: () => void;
	onProjectReady?: (loaded: Loaded) => void;
};

type Phase =
	| {kind: 'pickFolder'}
	| {kind: 'loading'}
	| {kind: 'inFlow'; loaded: Loaded}
	| {kind: 'allDone'; loaded: Loaded}
	| {kind: 'error'; message: string};

export default function SetupProject({onDone, onProjectReady}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'pickFolder'});

	useInput(
		() => {
			onDone();
		},
		{isActive: phase.kind === 'allDone' || phase.kind === 'error'},
	);

	useEffect(() => {
		if (phase.kind === 'allDone' && onProjectReady) {
			onProjectReady(phase.loaded);
		}
	}, [phase, onProjectReady]);

	if (phase.kind === 'pickFolder') {
		return (
			<FolderPicker
				onPicked={async dest => {
					setPhase({kind: 'loading'});
					try {
						const loaded = await loadOrInit(dest);
						setPhase(buildAdvancedPhase(loaded));
					} catch (err) {
						setPhase({
							kind: 'error',
							message: err instanceof Error ? err.message : String(err),
						});
					}
				}}
			/>
		);
	}

	if (phase.kind === 'loading') {
		return (
			<FrameTitle subtitle="Loading…">
				<Text>Reading project state…</Text>
			</FrameTitle>
		);
	}

	if (phase.kind === 'inFlow') {
		return (
			<InFlow
				loaded={phase.loaded}
				onAdvance={async updates => {
					try {
						const next = await applyUpdate(phase.loaded, updates);
						setPhase(buildAdvancedPhase(next));
					} catch (err) {
						setPhase({
							kind: 'error',
							message: err instanceof Error ? err.message : String(err),
						});
					}
				}}
				onAbort={message => setPhase({kind: 'error', message})}
			/>
		);
	}

	if (phase.kind === 'allDone') {
		const {loaded} = phase;
		return (
			<FrameTitle subtitle="Project ready">
				<Text color="green" bold>
					✓ {loaded.mode === 'created' ? 'Setup complete.' : 'Project up to date.'}
				</Text>
				<Text>
					Project: <Text color="cyan">{loaded.config.projectName ?? '(unnamed)'}</Text>
				</Text>
				{loaded.config.gitRepo ? (
					<Text>
						Git repo: <Text color="cyan">{loaded.config.gitRepo}</Text>
					</Text>
				) : null}
				<Text dimColor>{loaded.configPath}</Text>
				<Text dimColor>Press any key to return.</Text>
			</FrameTitle>
		);
	}

	return (
		<FrameTitle subtitle="Error">
			<Text color="red" bold>✗ {phase.message}</Text>
			<Text dimColor>Press any key to return.</Text>
		</FrameTitle>
	);
}

function buildAdvancedPhase(loaded: Loaded): Phase {
	return nextPendingStep(loaded.config) === undefined
		? {kind: 'allDone', loaded}
		: {kind: 'inFlow', loaded};
}
