// Reads/writes the `NEPTUNE_BLOCK_STYLES` constant in wp-config.php
// via wp-cli. The constant holds a JSON-encoded array of block-style
// definitions; the active theme decodes it on init and registers each
// entry with register_block_style().
//
// Storage shape (one element per registration):
//   [{ "block": "core/button", "name": "fill-small", "label": "Fill Small" }, ...]
//
// We use --type=constant so the value lives in wp-config.php (read at
// boot, before DB connection). Strings only, so we json_encode/decode
// at the boundary.
import {shellSingleQuote, wpCli} from './wp-cli.js';
import type {StudioSession} from '../integrations/studio/mcp.js';

const CONSTANT_NAME = 'NEPTUNE_BLOCK_STYLES';

export type BlockStyleEntry = {
	block: string;
	name: string;
	label: string;
};

export async function readBlockStyles(
	session: StudioSession,
	nameOrPath: string,
): Promise<BlockStyleEntry[]> {
	let raw: string;
	try {
		raw = (
			await wpCli(session, nameOrPath, `config get ${CONSTANT_NAME}`)
		).trim();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// wp config get returns non-zero when the constant is missing.
		// Either we get a stderr message, or wp_cli surfaces the error.
		if (/does not exist|not defined|not set|Error/i.test(message)) {
			return [];
		}
		throw err;
	}
	if (raw === '') return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isBlockStyleEntry);
	} catch {
		return [];
	}
}

export async function writeBlockStyles(
	session: StudioSession,
	nameOrPath: string,
	entries: BlockStyleEntry[],
): Promise<void> {
	const payload = JSON.stringify(entries);
	const baseCommand =
		`config set ${CONSTANT_NAME} ${shellSingleQuote(payload)} --type=constant`;
	// `wp config set` errors when the constant doesn't exist; --add
	// errors when it does. Try update first (the common case after the
	// first run), fall back to insert.
	try {
		await wpCli(session, nameOrPath, baseCommand);
	} catch {
		await wpCli(session, nameOrPath, `${baseCommand} --add`);
	}
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

function isBlockStyleEntry(value: unknown): value is BlockStyleEntry {
	if (typeof value !== 'object' || value === null) return false;
	const o = value as Record<string, unknown>;
	return (
		typeof o['block'] === 'string' &&
		typeof o['name'] === 'string' &&
		typeof o['label'] === 'string'
	);
}
