// Shared shell for any step that streams a LogEvent generator and ends
// with success or error. Three setup steps and (in spirit) the build
// flows all follow this shape — keeping the runner state machine in one
// place so step files just describe what to run, not how to render it.
//
// `start` receives an AbortSignal; honouring it lets unmount actually
// stop in-flight fetches/child processes (and Agent SDK calls) instead of
// orphaning them.
import React, {useEffect, useRef, useState} from 'react';
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
	start: (signal: AbortSignal) => Promise<AsyncIterable<LogEvent>>;
	onSuccess: () => void;
	onAbort: (message: string) => void;
}) {
	const [events, setEvents] = useState<LogEvent[]>([]);
	const [status, setStatus] = useState<Status>('running');
	const [error, setError] = useState('');
	const errorRef = useRef('');

	useEffect(() => {
		const controller = new AbortController();
		let cancelled = false;

		(async () => {
			try {
				const gen = await start(controller.signal);
				for await (const ev of gen) {
					if (cancelled) return;
					setEvents(prev => [...prev, ev]);
				}
				if (!cancelled) {
					setStatus('success');
					onSuccess();
				}
			} catch (err) {
				if (cancelled) return;
				setStatus('error');
				const message = err instanceof Error ? err.message : String(err);
				errorRef.current = message;
				setError(message);
			}
		})();

		return () => {
			cancelled = true;
			controller.abort();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useInput(() => onAbort(errorRef.current), {isActive: status === 'error'});

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
