import React from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../../lib/menu.js';
import type {SelectionMetadata} from '../../integrations/figma/mcp.js';
import type {SpecialPullKind} from '../../lib/types.js';
import SelectionLine from './selection-line.js';

type ItemValue =
	| {kind: 'special'; special: SpecialPullKind}
	| {kind: 'cancel'};

export default function GateView({
	selection,
	selectionError,
	hasStyleGuide,
	hasTemplates,
	onSelect,
	onCancel,
	onRefresh,
}: {
	selection: SelectionMetadata | null;
	selectionError: Error | null;
	hasStyleGuide: boolean;
	hasTemplates: boolean;
	onSelect: (kind: SpecialPullKind) => void;
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
	if (!hasStyleGuide) {
		items.push({
			key: 'styleGuide',
			label: 'Pull Style Guide template from current selection',
			value: {kind: 'special', special: 'styleGuide'},
		});
	}
	if (!hasTemplates) {
		items.push({
			key: 'templates',
			label: 'Pull Templates layer from current selection',
			value: {kind: 'special', special: 'templates'},
		});
	}
	items.push({
		key: 'cancel',
		label: 'Cancel',
		value: {kind: 'cancel'},
	});

	const hasCoords =
		selection !== null &&
		selection.x !== undefined &&
		selection.y !== undefined;

	const checklist: Array<{label: string; done: boolean}> = [
		{label: 'Style Guide template', done: hasStyleGuide},
		{label: 'Templates layer', done: hasTemplates},
	];

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold color="cyan">Pull template</Text>

			<Box marginTop={1} flexDirection="column">
				<Text>
					Before pulling additional templates, the Style Guide template and
					Templates layer must be pulled first.
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				{checklist.map(item => (
					<Text key={item.label}>
						{item.done ? (
							<Text color="green">  ✓ </Text>
						) : (
							<Text color="yellow">  ✗ </Text>
						)}
						{item.label}
						{item.done ? (
							<Text dimColor> (pulled)</Text>
						) : (
							<Text dimColor> (missing)</Text>
						)}
					</Text>
				))}
			</Box>

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
				<Menu
					items={items}
					onSelect={item => {
						switch (item.value.kind) {
							case 'special':
								onSelect(item.value.special);
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
