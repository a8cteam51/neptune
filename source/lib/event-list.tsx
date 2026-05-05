// Renders a streaming event list. The trailing event spins while
// `status === 'running'` and settles to a bullet (•) or warning (!) once
// status flips. Used by every long-running view (figma-pull, build-*,
// setup steps via EventStep).
//
// Each rendered row keys off a monotonic id so appending a new event
// doesn't re-key the previously-active row (which would kill the
// spinner's animation continuity).
import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';

export type LogEvent = {
	kind: 'step' | 'warn' | 'success';
	message: string;
};

type Status = 'running' | 'success' | 'error';

const COLOR_BY_KIND = {
	step: undefined,
	warn: 'yellow',
	success: 'green',
} as const;

const SYMBOL_BY_KIND = {
	step: '•',
	warn: '!',
	success: '✓',
} as const;

export default function EventList({
	events,
	status,
}: {
	events: ReadonlyArray<LogEvent>;
	status: Status;
}) {
	return (
		<Box flexDirection="column">
			{events.map((ev, i) => {
				const isActive = status === 'running' && i === events.length - 1;
				const color = COLOR_BY_KIND[ev.kind];
				// Stable per-row key. The active row's key is fixed so React
				// keeps mounting it as new events stream in; non-active rows
				// have unique keys derived from index + message hash so two
				// identical messages don't share a key.
				const key = isActive ? '__active__' : `${i}:${ev.message}`;
				return (
					<Box key={key}>
						<Text color={color}>{'  '}</Text>
						{isActive ? (
							<Text color="cyan">
								<Spinner type="dots" />
							</Text>
						) : (
							<Text color={color}>{SYMBOL_BY_KIND[ev.kind]}</Text>
						)}
						<Text color={color}>{' ' + ev.message}</Text>
					</Box>
				);
			})}
		</Box>
	);
}
