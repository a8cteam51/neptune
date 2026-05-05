import React from 'react';
import {Text} from 'ink';
import type {SelectionMetadata} from '../../integrations/figma/mcp.js';

export default function SelectionLine({
	selection,
	selectionError,
	hasCoords,
}: {
	selection: SelectionMetadata | null;
	selectionError: Error | null;
	hasCoords: boolean;
}) {
	if (selectionError) {
		return <Text color="red">{selectionError.message}</Text>;
	}
	if (selection === null) {
		return (
			<Text color="yellow">
				No Figma selection — select a frame and refresh.
			</Text>
		);
	}
	if (selection.name === undefined) {
		return (
			<Text color="yellow">
				Couldn&apos;t parse a name from selection metadata.
			</Text>
		);
	}
	return (
		<Text>
			<Text color="green" bold>{selection.name}</Text>
			{hasCoords ? (
				<Text dimColor> {selection.x}:{selection.y}</Text>
			) : null}
		</Text>
	);
}
