import React from 'react';
import {Box, Text} from 'ink';
import TextStep from '../../lib/text-step.js';
import {validateProjectPath} from '../../lib/validators.js';
import FrameTitle from './frame.js';
import {CONFIG_FILENAME} from './types.js';

export default function FolderPicker({
	onPicked,
}: {
	onPicked: (dest: string) => void;
}) {
	return (
		<FrameTitle subtitle="Choose a project folder">
			<Text>
				Pick a folder. If it contains <Text color="cyan">{CONFIG_FILENAME}</Text>,
				Neptune will resume that project. Otherwise the folder must be empty
				and Neptune will initialize it.
			</Text>
			<Box marginTop={1}>
				<TextStep
					title=""
					hint="Enter to confirm. Tilde (~) is expanded."
					placeholder="./my-neptune-project"
					validate={validateProjectPath}
					onSubmit={onPicked}
				/>
			</Box>
		</FrameTitle>
	);
}
