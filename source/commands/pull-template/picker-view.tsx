import React from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import type {SelectionMetadata} from '../../integrations/figma/mcp.js';
import type {TitleCardRef} from '../setup-project/types.js';
import SelectionLine from './selection-line.js';

type ItemValue =
	| {kind: 'titleCard'; titleCard: TitleCardRef}
	| {kind: 'custom'}
	| {kind: 'refresh'}
	| {kind: 'cancel'};

export default function PickerView({
	selection,
	selectionError,
	titleCards,
	onSelectTitleCard,
	onSelectCustom,
	onCancel,
	onRefresh,
}: {
	selection: SelectionMetadata | null;
	selectionError: Error | null;
	titleCards: TitleCardRef[];
	onSelectTitleCard: (card: TitleCardRef) => void;
	onSelectCustom: () => void;
	onCancel: () => void;
	onRefresh: () => void;
}) {
	useInput((_input, key) => {
		if (key.escape) onCancel();
	});

	const items: Array<{key: string; label: string; value: ItemValue}> = [];
	titleCards.forEach((card, index) => {
		items.push({
			key: `tc:${card.id}:${index}`,
			label: `Pull ${card.name}`,
			value: {kind: 'titleCard', titleCard: card},
		});
	});
	items.push({
		key: 'custom',
		label: 'Custom — pull any selection',
		value: {kind: 'custom'},
	});
	items.push({
		key: 'refresh',
		label: 'Refresh Figma selection',
		value: {kind: 'refresh'},
	});
	items.push({
		key: 'cancel',
		label: 'Cancel',
		value: {kind: 'cancel'},
	});

	const hasCoords =
		selection !== null &&
		selection.x !== undefined &&
		selection.y !== undefined;

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Pull template</Text>

			<Box marginTop={1} flexDirection="column">
				<Text bold>Current Figma selection</Text>
				<Box marginTop={1}>
					<SelectionLine
						selection={selection}
						selectionError={selectionError}
						hasCoords={hasCoords}
					/>
				</Box>
				<Text dimColor>
					Select the matching frame in Figma before pulling.
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text bold>
					{titleCards.length === 0
						? 'No title cards found in Templates layer.'
						: 'Pick a template'}
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<SelectInput
					items={items}
					onSelect={item => {
						switch (item.value.kind) {
							case 'titleCard':
								onSelectTitleCard(item.value.titleCard);
								return;
							case 'custom':
								onSelectCustom();
								return;
							case 'refresh':
								onRefresh();
								return;
							case 'cancel':
								onCancel();
						}
					}}
				/>
			</Box>

			<Box marginTop={1}>
				<Text dimColor>Esc to cancel.</Text>
			</Box>
		</Box>
	);
}
