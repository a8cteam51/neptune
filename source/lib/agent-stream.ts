// Shared driver for Claude Agent SDK invocations. Handles the streaming
// message loop and surfaces a consistent set of progress events through
// `onEvent`:
//   - "Session ready — model …, plugins …, N skills available" on init.
//   - "Tool call: <name>" for each tool the agent invokes.
//   - "Generating response…" on the first text delta.
//   - "Generating response… N chars" throttled to once every 1500ms.
//   - "Response complete (N tokens, $X.XX)" on success or graceful
//     non-success result (e.g. error_max_turns) — we still surface cost.
//
// Returns the final assistant text with surrounding ``` fences stripped.
// Caller is responsible for any further validation (JSON parse, prefix
// check, etc.) and for writing the result.
//
// The `signal` option aborts the underlying SDK stream. It is wired into
// `query()` via the SDK's AbortController, so callers (typically
// EventStep) can cancel a paid run when the user backs out.
import {AbortError, query} from '@anthropic-ai/claude-agent-sdk';
import type {LogEvent} from './event-list.js';

// Block shapes the agent SDK accepts for image+text user content. Kept
// here as a single import surface so callers don't reach into the SDK
// for these — but we deliberately don't re-declare them: matching the
// SDK's structural shape via a narrowed local alias avoids drift.
export type TextBlock = {type: 'text'; text: string};
export type ImageBlock = {
	type: 'image';
	source: {type: 'base64'; media_type: 'image/png'; data: string};
};
export type ContentBlock = TextBlock | ImageBlock;
export type AgentInput = string | ContentBlock[];

export type AgentRunOptions = {
	cwd: string;
	pluginPath: string;
	maxTurns?: number;
	signal?: AbortSignal;
	// Defaults to '*' (allow all tools the plugin declares). Pass an
	// explicit list to lock the agent down further.
	allowedTools?: string[];
};

const PARTIAL_EMIT_INTERVAL_MS = 1500;
const DEFAULT_ALLOWED_TOOLS: string[] = ['*'];

export class AgentAbortedError extends Error {
	constructor() {
		super('Agent run aborted');
		this.name = 'AgentAbortedError';
	}
}

export async function runAgent(
	input: AgentInput,
	options: AgentRunOptions,
	onEvent: (ev: LogEvent) => void,
): Promise<string> {
	if (options.signal?.aborted) throw new AgentAbortedError();

	const abortController = new AbortController();
	const onUserAbort = () => abortController.abort();
	if (options.signal) {
		options.signal.addEventListener('abort', onUserAbort, {once: true});
	}

	const stream = query({
		prompt: typeof input === 'string' ? input : asMessageStream(input),
		options: {
			cwd: options.cwd,
			plugins: [{type: 'local', path: options.pluginPath}],
			allowedTools: options.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
			maxTurns: options.maxTurns ?? 10,
			includePartialMessages: true,
			abortController,
		},
	});

	let finalText = '';
	let cost: number | undefined;
	let outTokens: number | undefined;
	let partialChars = 0;
	let lastPartialEmit = 0;

	try {
		for await (const msg of stream) {
			if (options.signal?.aborted) throw new AgentAbortedError();

			if (msg.type === 'system' && msg.subtype === 'init') {
				const skillCount = msg.skills?.length ?? 0;
				const pluginNames = (msg.plugins ?? []).map(p => p.name).join(', ');
				onEvent({
					kind: 'step',
					message: `Session ready — model ${msg.model}${
						pluginNames ? `, plugins: ${pluginNames}` : ''
					}${
						skillCount
							? `, ${skillCount} skill${skillCount === 1 ? '' : 's'} available`
							: ''
					}`,
				});
			} else if (msg.type === 'stream_event') {
				const ev = msg.event as {
					type?: string;
					delta?: {type?: string; text?: string};
				};
				if (
					ev.type === 'content_block_delta' &&
					ev.delta?.type === 'text_delta' &&
					typeof ev.delta.text === 'string'
				) {
					const wasFirstDelta = partialChars === 0;
					partialChars += ev.delta.text.length;
					const now = Date.now();
					if (
						wasFirstDelta ||
						now - lastPartialEmit > PARTIAL_EMIT_INTERVAL_MS
					) {
						lastPartialEmit = now;
						onEvent({
							kind: 'step',
							message: wasFirstDelta
								? 'Generating response…'
								: `Generating response… ${partialChars} chars`,
						});
					}
				}
			} else if (msg.type === 'assistant') {
				const content = msg.message.content as Array<{
					type: string;
					text?: string;
					name?: string;
				}>;
				for (const block of content) {
					if (block.type === 'tool_use' && block.name) {
						onEvent({kind: 'step', message: `Tool call: ${block.name}`});
					}
				}
				const text = content
					.filter(b => b.type === 'text' && typeof b.text === 'string')
					.map(b => b.text!)
					.join('\n');
				if (text) {
					finalText = text;
				}
			} else if (msg.type === 'result') {
				cost = msg.total_cost_usd;
				outTokens = msg.usage?.output_tokens;
				if (msg.subtype === 'success') {
					if (typeof msg.result === 'string' && msg.result.length > 0) {
						finalText = msg.result;
					}
					break;
				}
				emitTally(onEvent, outTokens, cost);
				throw new Error(
					`Agent SDK returned non-success result: ${msg.subtype}`,
				);
			}
		}
	} catch (err) {
		if (
			err instanceof AbortError ||
			(err instanceof Error && err.name === 'AbortError') ||
			abortController.signal.aborted
		) {
			throw new AgentAbortedError();
		}
		throw err;
	} finally {
		options.signal?.removeEventListener('abort', onUserAbort);
	}

	if (!finalText) throw new Error('Empty response from Claude.');

	emitTally(onEvent, outTokens, cost);
	return stripFences(finalText);
}

function emitTally(
	onEvent: (ev: LogEvent) => void,
	outTokens: number | undefined,
	cost: number | undefined,
) {
	const tally: string[] = [];
	if (outTokens !== undefined) tally.push(`${outTokens} output tokens`);
	if (cost !== undefined) tally.push(`$${cost.toFixed(4)}`);
	onEvent({
		kind: 'step',
		message:
			tally.length > 0
				? `Response complete (${tally.join(', ')})`
				: 'Response complete',
	});
}

async function* asMessageStream(content: ContentBlock[]) {
	yield {
		type: 'user' as const,
		parent_tool_use_id: null,
		message: {role: 'user' as const, content},
	};
}

// Strip a single ```lang … ``` wrapping. Only when both an opening and
// matching closing fence exist on distinct lines — otherwise we leave the
// text alone to avoid silently eating legit content (truncated responses,
// templates that include their own <pre><code>).
export function stripFences(text: string): string {
	const trimmed = text.trim();
	if (!trimmed.startsWith('```')) return trimmed;
	const lines = trimmed.split('\n');
	if (lines.length < 2) return trimmed;
	const last = lines[lines.length - 1]!;
	if (!last.trim().startsWith('```')) return trimmed;
	return lines.slice(1, -1).join('\n').trim();
}
