// Cyan-themed wrapper around ink-select-input. The library's default
// indicator + item are blue; this component substitutes our cyan
// branding for both. Use everywhere a vertical menu is shown so the
// active-row colour is consistent across the app.
import React from 'react';
import {Box, Text} from 'ink';
import figures from 'figures';
import SelectInput from 'ink-select-input';

const ACTIVE_COLOR = 'cyan';

function CyanIndicator({isSelected = false}: {isSelected?: boolean}) {
	return (
		<Box marginRight={1}>
			{isSelected ? (
				<Text color={ACTIVE_COLOR}>{figures.pointer}</Text>
			) : (
				<Text> </Text>
			)}
		</Box>
	);
}

function CyanItem({
	isSelected = false,
	label,
}: {
	isSelected?: boolean;
	label: string;
}) {
	return <Text color={isSelected ? ACTIVE_COLOR : undefined}>{label}</Text>;
}

// Re-derive the generic prop shape from SelectInput so callers keep
// strong typing on their items / onSelect callbacks. A naked
// React.ComponentProps<typeof SelectInput> collapses the V generic to
// `unknown`, which breaks every typed call site.
type MenuItem<V> = {key?: string; label: string; value: V};

type MenuProps<V> = {
	items?: ReadonlyArray<MenuItem<V>>;
	isFocused?: boolean;
	initialIndex?: number;
	limit?: number;
	onSelect?: (item: MenuItem<V>) => void;
	onHighlight?: (item: MenuItem<V>) => void;
};

export default function Menu<V>(props: MenuProps<V>) {
	return (
		<SelectInput
			{...(props as MenuProps<V> & {items?: Array<MenuItem<V>>})}
			indicatorComponent={CyanIndicator}
			itemComponent={CyanItem}
		/>
	);
}
