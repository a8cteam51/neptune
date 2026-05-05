// Keyboard-driven checkbox list. Used by refine-template to let the
// user trim the diff agent's findings before sending them to the fix
// agent — every item starts selected; user toggles off the ones they
// don't want and presses Enter to submit, or Esc to bail.
//
// Controls: ↑/↓ move cursor; Space toggles; A toggles all; Enter
// submits selected items; Esc cancels.
import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

export type MultiSelectItem<T> = {
	key: string;
	label: string;
	hint?: string;
	value: T;
};

export type MultiSelectProps<T> = {
	items: ReadonlyArray<MultiSelectItem<T>>;
	onSubmit: (selected: T[]) => void;
	onCancel: () => void;
};

export default function MultiSelect<T>({
	items,
	onSubmit,
	onCancel,
}: MultiSelectProps<T>) {
	const [cursor, setCursor] = useState(0);
	const [selected, setSelected] = useState<Set<string>>(
		() => new Set(items.map(i => i.key)),
	);

	useInput((input, key) => {
		if (key.escape) {
			onCancel();
			return;
		}
		if (key.return) {
			const chosen = items
				.filter(item => selected.has(item.key))
				.map(item => item.value);
			onSubmit(chosen);
			return;
		}
		if (key.upArrow) {
			setCursor(c => (items.length === 0 ? 0 : (c - 1 + items.length) % items.length));
			return;
		}
		if (key.downArrow) {
			setCursor(c => (items.length === 0 ? 0 : (c + 1) % items.length));
			return;
		}
		if (input === ' ') {
			toggle(items[cursor]?.key);
			return;
		}
		if (input === 'a' || input === 'A') {
			setSelected(prev =>
				prev.size === items.length ? new Set() : new Set(items.map(i => i.key)),
			);
		}
	});

	const toggle = (key: string | undefined) => {
		if (key === undefined) return;
		setSelected(prev => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	return (
		<Box flexDirection="column">
			{items.length === 0 ? (
				<Text dimColor>No items.</Text>
			) : (
				items.map((item, i) => {
					const isSelected = selected.has(item.key);
					const isCursor = i === cursor;
					const checkbox = isSelected ? '[x]' : '[ ]';
					const arrow = isCursor ? '›' : ' ';
					return (
						<Box key={item.key}>
							<Text color={isCursor ? 'yellow' : undefined}>{arrow} </Text>
							<Text color={isSelected ? 'green' : undefined}>{checkbox} </Text>
							<Text bold={isCursor}>{item.label}</Text>
							{item.hint ? <Text dimColor>{' — ' + item.hint}</Text> : null}
						</Box>
					);
				})
			)}
			<Box marginTop={1}>
				<Text dimColor>
					↑/↓ move · Space toggle · A toggle-all · Enter confirm · Esc cancel
				</Text>
			</Box>
		</Box>
	);
}
