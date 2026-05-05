import React, {useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import type {NeptuneConfig} from './types.js';

export default function GitRepoStep({
	config,
	onComplete,
}: {
	config: NeptuneConfig;
	onComplete: (updates: Partial<NeptuneConfig>) => void;
}) {
	const [value, setValue] = useState(config.gitRepo ?? '');
	const [error, setError] = useState('');

	const submit = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Git repo URL cannot be empty.');
			return;
		}
		onComplete({
			gitRepo: trimmed,
			steps: {...config.steps, gitRepoConfigured: true},
		});
	};

	return (
		<Box flexDirection="column">
			<Text bold>Step 2 — Project Git repo</Text>
			<Text dimColor>HTTPS or SSH URL.</Text>
			<Box marginTop={1}>
				<Text color="yellow">› </Text>
				<TextInput
					value={value}
					onChange={setValue}
					onSubmit={submit}
					placeholder="git@github.com:org/repo.git"
				/>
			</Box>
			{error === '' ? null : <Text color="red">{error}</Text>}
		</Box>
	);
}
