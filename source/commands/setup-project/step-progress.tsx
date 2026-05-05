import React from 'react';
import {Box, Text} from 'ink';
import {STEP_LABELS} from './steps-meta.js';
import type {NeptuneConfig} from './types.js';

export default function StepProgress({config}: {config: NeptuneConfig}) {
	const rows: Array<{label: string; done: boolean}> = [
		{label: 'Project initialized', done: config.steps.initialized},
		...STEP_LABELS.map(({key, label}) => ({
			label,
			done: config.steps[key],
		})),
	];
	return (
		<Box flexDirection="column">
			{rows.map(r => (
				<Text
					key={r.label}
					color={r.done ? 'green' : undefined}
					dimColor={!r.done}
				>
					{r.done ? '  ✓ ' : '  · '}
					{r.label}
				</Text>
			))}
		</Box>
	);
}
