import React, {useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import type {NeptuneConfig} from './types.js';

export default function ThemeStep({
	config,
	onComplete,
}: {
	config: NeptuneConfig;
	onComplete: (updates: Partial<NeptuneConfig>) => void;
}) {
	const [value, setValue] = useState(config.themeSlug ?? '');
	const [error, setError] = useState('');

	const submit = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Theme slug cannot be empty.');
			return;
		}
		if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
			setError('Theme slug must be lowercase, alphanumeric or hyphens.');
			return;
		}
		onComplete({
			themeSlug: trimmed,
			steps: {...config.steps, themeConfigured: true},
		});
	};

	return (
		<Box flexDirection="column">
			<Text bold>Step 3 — Theme slug</Text>
			<Text dimColor>
				Lowercase, alphanumeric, hyphens. Must match a theme directory in
				wp-content/themes/.
			</Text>
			<Box marginTop={1}>
				<Text color="yellow">› </Text>
				<TextInput
					value={value}
					onChange={setValue}
					onSubmit={submit}
					placeholder="my-theme"
				/>
			</Box>
			{error === '' ? null : <Text color="red">{error}</Text>}
		</Box>
	);
}
