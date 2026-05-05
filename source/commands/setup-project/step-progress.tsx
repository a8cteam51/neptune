import React from 'react';
import {Box, Text} from 'ink';
import type {NeptuneConfig} from './types.js';

export default function StepProgress({config}: {config: NeptuneConfig}) {
	const rows: Array<{label: string; done: boolean}> = [
		{label: 'Project initialized', done: config.steps.initialized},
		{label: 'Project named', done: config.steps.projectNamed === true},
		{label: 'Git repo configured', done: config.steps.gitRepoConfigured === true},
		{label: 'Theme slug configured', done: config.steps.themeConfigured === true},
		{
			label: 'WordPress installed',
			done: config.steps.wordpressInstalled === true,
		},
		{
			label: 'wp-content cloned from repo',
			done: config.steps.wpContentCloned === true,
		},
		{
			label: 'Studio site created',
			done: config.steps.studioSiteCreated === true,
		},
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
