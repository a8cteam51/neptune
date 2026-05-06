// Reads/writes the `NEPTUNE_BLOCK_STYLES` constant in wp-config.php
// via the `wp neptune block-styles-*` subcommands shipped with the
// active theme (<theme>/inc/class-neptune-cli.php). The constant
// holds a JSON-encoded array of block-style definitions; the active
// theme decodes it on init and registers each entry with
// register_block_style().
//
// Storage shape (one element per registration):
//   [{ "block": "core/button", "name": "fill-small", "label": "Fill Small" }, ...]
import {b64Arg, runNeptuneCli} from './neptune-cli.js';
import {dArray, dBoolean, dNumber, dObject, dString} from './decode.js';
import type {StudioSession} from '../integrations/studio/mcp.js';

export type BlockStyleEntry = {
	block: string;
	name: string;
	label: string;
};

const dEntry = dObject({
	block: dString,
	name: dString,
	label: dString,
});

const dGetResult = dObject({entries: dArray(dEntry)});
const dSetResult = dObject({ok: dBoolean, count: dNumber});

export async function readBlockStyles(
	session: StudioSession,
	nameOrPath: string,
): Promise<BlockStyleEntry[]> {
	const result = await runNeptuneCli(
		session,
		nameOrPath,
		'block-styles-get',
		{},
		dGetResult,
	);
	return result.entries;
}

export async function writeBlockStyles(
	session: StudioSession,
	nameOrPath: string,
	entries: BlockStyleEntry[],
): Promise<void> {
	await runNeptuneCli(
		session,
		nameOrPath,
		'block-styles-set',
		{json: b64Arg(JSON.stringify(entries))},
		dSetResult,
	);
}

export function upsertBlockStyle(
	current: BlockStyleEntry[],
	entry: BlockStyleEntry,
): BlockStyleEntry[] {
	const idx = current.findIndex(
		e => e.block === entry.block && e.name === entry.name,
	);
	if (idx >= 0) {
		const next = current.slice();
		next[idx] = entry;
		return next;
	}
	return [...current, entry];
}
