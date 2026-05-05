import React, {useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import FrameTitle from './frame.js';
import {CONFIG_FILENAME} from './types.js';

export default function FolderPicker({
	onPicked,
}: {
	onPicked: (dest: string) => void;
}) {
	const [value, setValue] = useState('');
	const [error, setError] = useState('');

	const handleSubmit = (raw: string) => {
		const trimmed = raw.trim();
		if (trimmed === '') {
			setError('Please enter a destination path.');
			return;
		}
		const expanded = trimmed.startsWith('~')
			? trimmed.replace(/^~/, homedir())
			: trimmed;
		onPicked(resolve(expanded));
	};

	return (
		<FrameTitle subtitle="Choose a project folder">
			<Text>
				Pick a folder. If it contains <Text color="cyan">{CONFIG_FILENAME}</Text>,
				Neptune will resume that project. Otherwise the folder must be empty
				and Neptune will initialize it.
			</Text>
			<Box marginTop={1}>
				<Text color="yellow">› </Text>
				<TextInput
					value={value}
					onChange={setValue}
					onSubmit={handleSubmit}
					placeholder="./my-neptune-project"
				/>
			</Box>
			<Text dimColor>Enter to confirm. Tilde (~) is expanded.</Text>
			{error === '' ? null : <Text color="red">{error}</Text>}
		</FrameTitle>
	);
}
