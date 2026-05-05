// Shared input box used by setup-project's text-only steps (project
// name, git repo, theme slug). Encapsulates trim + validate + submit so
// step files only describe titling, hint text, and the validator.
import React, {useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';

type ValidatorResult = {ok: true; value: string} | {ok: false; error: string};

export default function TextStep({
	title,
	hint,
	placeholder,
	initialValue,
	validate,
	onSubmit,
}: {
	title: string;
	hint?: string;
	placeholder?: string;
	initialValue?: string;
	validate: (raw: string) => ValidatorResult;
	onSubmit: (value: string) => void;
}) {
	const [value, setValue] = useState(initialValue ?? '');
	const [error, setError] = useState('');

	const submit = (raw: string) => {
		const result = validate(raw);
		if (!result.ok) {
			setError(result.error);
			return;
		}
		setError('');
		onSubmit(result.value);
	};

	return (
		<Box flexDirection="column">
			<Text bold>{title}</Text>
			{hint ? <Text dimColor>{hint}</Text> : null}
			<Box marginTop={1}>
				<Text color="yellow">› </Text>
				<TextInput
					value={value}
					onChange={setValue}
					onSubmit={submit}
					placeholder={placeholder}
				/>
			</Box>
			{error === '' ? null : <Text color="red">{error}</Text>}
		</Box>
	);
}

export type {ValidatorResult};
