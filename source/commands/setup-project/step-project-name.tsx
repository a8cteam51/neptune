import React, {useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import type {NeptuneConfig} from './types.js';

export default function ProjectNameStep({
	config,
	onComplete,
}: {
	config: NeptuneConfig;
	onComplete: (updates: Partial<NeptuneConfig>) => void;
}) {
	const [value, setValue] = useState(config.projectName ?? '');
	const [error, setError] = useState('');

	const submit = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Project name cannot be empty.');
			return;
		}
		onComplete({
			projectName: trimmed,
			steps: {...config.steps, projectNamed: true},
		});
	};

	return (
		<Box flexDirection="column">
			<Text bold>Step 1 — Name your project</Text>
			<Box marginTop={1}>
				<Text color="yellow">› </Text>
				<TextInput
					value={value}
					onChange={setValue}
					onSubmit={submit}
					placeholder="My Neptune Project"
				/>
			</Box>
			{error === '' ? null : <Text color="red">{error}</Text>}
		</Box>
	);
}
