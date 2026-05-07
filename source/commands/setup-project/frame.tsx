import React from 'react';
import {Box, Text} from 'ink';

export default function FrameTitle({
	subtitle,
	children,
}: {
	subtitle: string;
	children: React.ReactNode;
}) {
	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">
				Setup / Load Project
			</Text>
			<Text dimColor>{subtitle}</Text>
			<Box marginTop={1} flexDirection="column">
				{children}
			</Box>
		</Box>
	);
}
