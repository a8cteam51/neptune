// Owns the MCP session for one logical pull. Opens the session, runs
// pullFromFigma, then hands the same session to onSuccess so post-pull
// work (asset download, dev-note fetch, scaffolding) reuses it instead
// of opening a fresh one. Each session = 2 MCP requests (init + notify),
// so reuse matters for the rate-limit budget.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import EventList, {type LogEvent} from '../../lib/event-list.js';
import {
	openMcpSession,
	pullFromFigma,
	type McpSession,
} from './mcp.js';

type Props = {
	pageName: string;
	nodeRef: string;
	outRoot?: string;
	onSuccess?: (
		emit: (ev: LogEvent) => void,
		session: McpSession,
	) => Promise<void> | void;
	onDone: () => void;
};

type Status = 'running' | 'success' | 'error';

export default function FigmaPull({
	pageName,
	nodeRef,
	outRoot,
	onSuccess,
	onDone,
}: Props) {
	const [events, setEvents] = useState<LogEvent[]>([]);
	const [status, setStatus] = useState<Status>('running');
	const [error, setError] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				setEvents(prev => [
					...prev,
					{kind: 'step', message: 'Opening MCP session…'},
				]);
				const session = await openMcpSession();

				for await (const ev of pullFromFigma(session, {
					pageName,
					nodeRef,
					outRoot,
				})) {
					if (cancelled) return;
					setEvents(prev => [...prev, ev]);
				}

				if (cancelled) return;

				if (onSuccess) {
					const emit = (ev: LogEvent) => {
						if (!cancelled) setEvents(prev => [...prev, ev]);
					};
					try {
						await onSuccess(emit, session);
					} catch (err) {
						if (cancelled) return;
						setEvents(prev => [
							...prev,
							{
								kind: 'warn',
								message: `Could not record pull: ${
									err instanceof Error ? err.message : String(err)
								}`,
							},
						]);
					}
				}

				if (!cancelled) {
					setStatus('success');
				}
			} catch (err) {
				if (!cancelled) {
					setStatus('error');
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		})();

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pageName, nodeRef, outRoot]);

	useInput(
		() => {
			onDone();
		},
		{isActive: status !== 'running'},
	);

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold>
				Pulling template <Text color="cyan">{pageName}</Text>
				{nodeRef === '' ? (
					<Text dimColor> (current Figma selection)</Text>
				) : (
					<Text dimColor> from {nodeRef}</Text>
				)}
			</Text>

			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>

			{status === 'success' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="green" bold>
						✓ Pull complete.
					</Text>
					<Text dimColor>Press any key to return to the menu.</Text>
				</Box>
			) : null}

			{status === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>
						✗ Pull failed.
					</Text>
					<Text color="red">{error}</Text>
					<Text dimColor>Press any key to return to the menu.</Text>
				</Box>
			) : null}
		</Box>
	);
}
