// Vertical menu that supports non-selectable section headers
// interleaved with selectable items. Arrow keys jump over headers, so
// the cursor only ever lands on something the user can act on. Used
// for the top-level app menu where commands are grouped under
// category labels (Figma / Styles / Patterns / Templates / Content).
//
// Kept separate from lib/menu.tsx (a thin ink-select-input wrapper)
// because ink-select-input doesn't model unselectable rows. Keyboard
// handling here is hand-rolled — the surface area is small enough
// that pulling in another dep isn't justified.
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import figures from 'figures';

export type SectionedItem<V> =
	| {kind: 'header'; key: string; label: string}
	| {kind: 'item'; key: string; label: string; value: V};

type Props<V> = {
	items: ReadonlyArray<SectionedItem<V>>;
	onSelect: (value: V) => void;
	isFocused?: boolean;
};

const ACTIVE_COLOR = 'cyan';

export default function SectionedMenu<V>({
	items,
	onSelect,
	isFocused = true,
}: Props<V>) {
	const selectableIndices = items
		.map((item, i) => (item.kind === 'item' ? i : -1))
		.filter(i => i !== -1);

	const [cursor, setCursor] = useState(() =>
		selectableIndices.length > 0 ? selectableIndices[0]! : 0,
	);

	// If items shrink/change so the cursor lands on a non-item (or out of
	// bounds) reset to the first selectable row. Without this, a project
	// gaining or losing pulls between renders can leave the cursor stuck.
	useEffect(() => {
		if (selectableIndices.length === 0) return;
		if (
			cursor < 0 ||
			cursor >= items.length ||
			items[cursor]?.kind !== 'item'
		) {
			setCursor(selectableIndices[0]!);
		}
	}, [items, cursor, selectableIndices]);

	useInput(
		(_input, key) => {
			if (selectableIndices.length === 0) return;
			if (key.upArrow) {
				setCursor(c => previousSelectable(selectableIndices, c));
				return;
			}
			if (key.downArrow) {
				setCursor(c => nextSelectable(selectableIndices, c));
				return;
			}
			if (key.return) {
				const item = items[cursor];
				if (item && item.kind === 'item') onSelect(item.value);
			}
		},
		{isActive: isFocused},
	);

	return (
		<Box flexDirection="column">
			{items.map((item, i) => {
				if (item.kind === 'header') {
					return (
						<Box key={item.key} marginTop={i === 0 ? 0 : 1}>
							<Text bold color={ACTIVE_COLOR}>
								{item.label}
							</Text>
						</Box>
					);
				}
				const isCursor = i === cursor;
				return (
					<Box key={item.key}>
						<Box marginRight={1}>
							{isCursor ? (
								<Text color={ACTIVE_COLOR}>{figures.pointer}</Text>
							) : (
								<Text> </Text>
							)}
						</Box>
						<Text color={isCursor ? ACTIVE_COLOR : undefined}>
							  {item.label}
						</Text>
					</Box>
				);
			})}
		</Box>
	);
}

function nextSelectable(indices: number[], current: number): number {
	const i = indices.indexOf(current);
	if (i === -1) return indices[0]!;
	return indices[(i + 1) % indices.length]!;
}

function previousSelectable(indices: number[], current: number): number {
	const i = indices.indexOf(current);
	if (i === -1) return indices[indices.length - 1]!;
	return indices[(i - 1 + indices.length) % indices.length]!;
}
