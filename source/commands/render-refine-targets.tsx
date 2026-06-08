// Render refine targets UI shell. Re-renders a Claude Design package's
// static references into design/<slug>/screenshot.png + meta.json so the
// refine loop (Refine templates / View template diff) has something to
// diff against — WITHOUT re-running the paid standardize agent. Starts
// immediately on mount; no picker. Used to recover when an import's render
// step failed, or to re-render after editing the package's references.
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import EventList, {type LogEvent} from '../lib/event-list.js';
import {runRegenerateRefineTargets} from '../integrations/claude-design/import.js';
import type {Loaded} from './setup-project/types.js';

type Props = {
	activeProject: Loaded;
	onDone: (refresh?: boolean) => void;
};

type Phase =
	| {kind: 'running'}
	| {kind: 'done'; count: number}
	| {kind: 'error'; error: string};

export default function RenderRefineTargets({activeProject, onDone}: Props) {
	const [phase, setPhase] = useState<Phase>({kind: 'running'});
	const [events, setEvents] = useState<LogEvent[]>([]);
	const controllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		const controller = new AbortController();
		controllerRef.current = controller;
		(async () => {
			try {
				const targets = await runRegenerateRefineTargets(
					activeProject,
					controller.signal,
					ev => {
						if (!controller.signal.aborted) setEvents(prev => [...prev, ev]);
					},
				);
				if (controller.signal.aborted) return;
				setPhase({kind: 'done', count: targets.length});
			} catch (err) {
				if (controller.signal.aborted) return;
				setPhase({
					kind: 'error',
					error: err instanceof Error ? err.message : String(err),
				});
			}
		})();
		return () => controller.abort();
	}, [activeProject]);

	useInput(() => onDone(phase.kind === 'done'), {
		isActive: phase.kind === 'done' || phase.kind === 'error',
	});

	const status =
		phase.kind === 'running'
			? 'running'
			: phase.kind === 'done'
				? 'success'
				: 'error';

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">
				Render refine targets
			</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{phase.kind === 'done' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color={phase.count > 0 ? 'green' : 'yellow'} bold>
						{phase.count > 0
							? `✓ ${phase.count} refine target${phase.count === 1 ? '' : 's'} ready.`
							: 'No refine targets generated (no static references to render).'}
					</Text>
					{phase.count > 0 ? (
						<Text dimColor>
							“Refine templates” and “View template diff” are now available.
						</Text>
					) : null}
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
			{phase.kind === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>
						✗ Could not render refine targets.
					</Text>
					<Text color="red">{phase.error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
		</Box>
	);
}
