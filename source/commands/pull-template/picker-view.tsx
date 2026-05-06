import React from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../../lib/menu.js';
import type {SelectionMetadata} from '../../integrations/figma/mcp.js';
import type {TitleCardRef} from '../../lib/types.js';
import SelectionLine from './selection-line.js';
import {slugify} from './special-meta.js';

type ItemValue =
	| {kind: 'titleCard'; titleCard: TitleCardRef}
	| {kind: 'custom'}
	| {kind: 'cancel'};

export default function PickerView({
	selection,
	selectionError,
	titleCards,
	pulledSlugs,
	onSelectTitleCard,
	onSelectCustom,
	onCancel,
	onRefresh,
}: {
	selection: SelectionMetadata | null;
	selectionError: Error | null;
	titleCards: TitleCardRef[];
	pulledSlugs: ReadonlySet<string>;
	onSelectTitleCard: (card: TitleCardRef) => void;
	onSelectCustom: () => void;
	onCancel: () => void;
	onRefresh: () => void;
}) {
	useInput((input, key) => {
		if (key.escape) {
			onCancel();
			return;
		}
		if (input === 'r' || input === 'R') {
			onRefresh();
		}
	});

	const items: Array<{key: string; label: string; value: ItemValue}> = [];
	titleCards.forEach((card, index) => {
		const alreadyPulled = pulledSlugs.has(slugify(card.name));
		items.push({
			key: `tc:${card.id}:${index}`,
			label: alreadyPulled
				? `Pull ${card.name} — (pulled)`
				: `Pull ${card.name}`,
			value: {kind: 'titleCard', titleCard: card},
		});
	});
	items.push({
		key: 'custom',
		label: 'Custom — pull any selection',
		value: {kind: 'custom'},
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
				<Menu
					items={items}
					onSelect={item => {
						switch (item.value.kind) {
							case 'titleCard':
								onSelectTitleCard(item.value.titleCard);
								return;
							case 'custom':
								onSelectCustom();
								return;
							case 'cancel':
								onCancel();
						}
					}}
				/>
			</Box>

			<Box marginTop={1}>
				<Text dimColor>Esc to cancel · R to refresh Figma selection.</Text>
			</Box>
		</Box>
	);
}
