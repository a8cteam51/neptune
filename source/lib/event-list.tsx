// Renders a streaming event list. The trailing event spins while
// `status === 'running'` and settles to a bullet (•) or warning (!) once
// status flips. Used by every long-running view (figma-pull, build-*,
// setup steps via EventStep).
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
				return (
					<Box key={i}>
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
