// Per-id MCP fetch for dev notes found in the dev-handoff metadata.xml.
// This is the most rate-limit-expensive operation in the app: one
// get_design_context call per dev note. Caller passes in a shared session
// so we don't pay extra session-init requests.
//
// Rate-limit handling: stop iterating immediately on FigmaRateLimitError
// (continuing would just rack up more failed calls). Per-id failures of
// any other kind are recorded as `{id}` (no text) and the loop continues.
import type {LogEvent} from '../../lib/event-list.js';
import {extractJsxText} from './handoff-parse.js';
import {
	FigmaRateLimitError,
	joinTextContent,
	stripLlmInstructions,
	type McpSession,
} from './mcp.js';
import type {DevNote} from '../../lib/types.js';

export async function fetchDevNoteTexts(
	session: McpSession,
	ids: string[],
	onEvent?: (ev: LogEvent) => void,
	signal?: AbortSignal,
): Promise<DevNote[]> {
	if (ids.length === 0) return [];

	onEvent?.({
		kind: 'step',
		message: `Fetching text for ${ids.length} dev note${
			ids.length === 1 ? '' : 's'
		}…`,
	});

	const notes: DevNote[] = [];

	for (const [index, id] of ids.entries()) {
		if (signal?.aborted) throw new Error('Dev note fetch aborted.');
		onEvent?.({
			kind: 'step',
			message: `Dev note ${index + 1}/${ids.length} (${id})`,
		});
		try {
			const resp = await session.call('get_design_context', {nodeId: id});
			const raw = joinTextContent(resp);
			const cleaned = stripLlmInstructions('code.tsx', raw);
			const text = extractJsxText(cleaned);
			notes.push(text === '' ? {id} : {id, text});
		} catch (err) {
			if (err instanceof FigmaRateLimitError) {
				onEvent?.({
					kind: 'warn',
					message: `Stopping dev note fetch: ${err.message}`,
				});
				throw err;
			}
			onEvent?.({
				kind: 'warn',
				message: `Dev note ${id} fetch failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
			});
			notes.push({id});
		}
	}

	onEvent?.({
		kind: 'step',
		message: `Captured ${notes.filter(n => n.text !== undefined).length}/${
			ids.length
		} dev note text${ids.length === 1 ? '' : 's'}`,
	});

	return notes;
}
