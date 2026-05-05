// Shared shell for any step that streams a LogEvent generator and ends
// with success or error. Three setup steps and (in spirit) the build
// flows all follow this shape — keeping the runner state machine in one
// place so step files just describe what to run, not how to render it.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import EventList, {type LogEvent} from './event-list.js';

type Status = 'running' | 'success' | 'error';

export default function EventStep({
	title,
	start,
	onSuccess,
	onAbort,
}: {
	title: string;
	start: () => Promise<AsyncIterable<LogEvent>>;
	onSuccess: () => void;
	onAbort: (message: string) => void;
}) {
	const [events, setEvents] = useState<LogEvent[]>([]);
	const [status, setStatus] = useState<Status>('running');
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const gen = await start();
				for await (const ev of gen) {
					if (cancelled) return;
					setEvents(prev => [...prev, ev]);
				}
				if (!cancelled) {
					setStatus('success');
					onSuccess();
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
	}, []);

	useInput(() => onAbort(error), {isActive: status === 'error'});

	return (
		<Box flexDirection="column">
			<Text bold>{title}</Text>
			<Box marginTop={1}>
				<EventList events={events} status={status} />
			</Box>
			{status === 'error' ? (
				<Box marginTop={1} flexDirection="column">
					<Text color="red" bold>✗ {error}</Text>
					<Text dimColor>Press any key to return.</Text>
				</Box>
			) : null}
		</Box>
	);
}
