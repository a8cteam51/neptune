// Shared driver for agent SDK invocations. Handles the streaming
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
// the provider SDK, so callers (typically EventStep) can cancel a paid
// run when the user backs out.
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AbortError, query} from '@anthropic-ai/claude-agent-sdk';
import {Codex} from '@openai/codex-sdk';
import {normalizeAgentProvider, type AgentProvider} from './agent-provider.js';
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
	provider?: AgentProvider;
	maxTurns?: number;
	signal?: AbortSignal;
	// Defaults to '*' (allow all tools the plugin declares). Pass an
	// explicit list to lock the agent down further.
	allowedTools?: string[];
};

const PARTIAL_EMIT_INTERVAL_MS = 1500;
const DEFAULT_ALLOWED_TOOLS: string[] = ['*'];
const CONFIG_FILENAME = 'neptune-config.json';

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
	const provider =
		options.provider ?? (await readProviderFromConfig(options.cwd));
	if (provider === 'codex') {
		return runCodexAgent(input, options, onEvent);
	}
	return runClaudeAgent(input, options, onEvent);
}

async function runClaudeAgent(
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
	let inputTokens: number | undefined;
	let outputTokens: number | undefined;
	let cacheReadTokens: number | undefined;
	let cacheCreationTokens: number | undefined;
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
				inputTokens = msg.usage?.input_tokens;
				outputTokens = msg.usage?.output_tokens;
				cacheReadTokens = msg.usage?.cache_read_input_tokens;
				cacheCreationTokens = msg.usage?.cache_creation_input_tokens;
				if (msg.subtype === 'success') {
					if (typeof msg.result === 'string' && msg.result.length > 0) {
						finalText = msg.result;
					}
					break;
				}
				emitTally(onEvent, {
					cost,
					inputTokens,
					outputTokens,
					cacheReadTokens,
					cacheCreationTokens,
				});
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

	emitTally(onEvent, {
		cost,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens,
	});
	return stripFences(finalText);
}

type CodexInput = string | CodexInputItem[];

type CodexInputItem =
	| {type: 'text'; text: string}
	| {type: 'local_image'; path: string};

async function runCodexAgent(
	input: AgentInput,
	options: AgentRunOptions,
	onEvent: (ev: LogEvent) => void,
): Promise<string> {
	if (options.signal?.aborted) throw new AgentAbortedError();

	let tempDir: string | undefined;
	let finalText = '';
	let inputTokens: number | undefined;
	let outputTokens: number | undefined;
	let cacheReadTokens: number | undefined;
	let generationStarted = false;

	try {
		const prepared = await prepareCodexInput(
			input,
			options.pluginPath,
			async () => {
				tempDir ??= await mkdtemp(join(tmpdir(), 'neptune-codex-images-'));
				return tempDir;
			},
		);
		onEvent({
			kind: 'step',
			message: `Session ready — provider codex${
				prepared.skillName ? `, skill: ${prepared.skillName}` : ''
			}`,
		});

		const codex = new Codex();
		const thread = codex.startThread({
			workingDirectory: options.cwd,
			skipGitRepoCheck: true,
			sandboxMode: 'read-only',
			approvalPolicy: 'never',
			networkAccessEnabled: false,
			webSearchMode: 'disabled',
		});
		const {events} = await thread.runStreamed(prepared.input, {
			signal: options.signal,
		});

		for await (const event of events) {
			if (options.signal?.aborted) throw new AgentAbortedError();

			if (event.type === 'item.started') {
				emitCodexItemStarted(event.item, onEvent);
			} else if (event.type === 'item.completed') {
				if (event.item.type === 'agent_message') {
					if (!generationStarted) {
						generationStarted = true;
						onEvent({kind: 'step', message: 'Generating response…'});
					}
					finalText = event.item.text;
				} else {
					emitCodexItemCompleted(event.item, onEvent);
				}
			} else if (event.type === 'turn.completed') {
				inputTokens = event.usage.input_tokens;
				outputTokens = event.usage.output_tokens;
				cacheReadTokens = event.usage.cached_input_tokens;
			} else if (event.type === 'turn.failed') {
				throw new Error(`Codex SDK returned failure: ${event.error.message}`);
			} else if (event.type === 'error') {
				throw new Error(`Codex SDK error: ${event.message}`);
			}
		}
	} catch (err) {
		if (
			options.signal?.aborted ||
			(err instanceof Error && err.name === 'AbortError')
		) {
			throw new AgentAbortedError();
		}
		throw err;
	} finally {
		if (tempDir) {
			try {
				await rm(tempDir, {recursive: true, force: true});
			} catch {
				// Temporary image cleanup should not mask the agent result.
			}
		}
	}

	if (!finalText) throw new Error('Empty response from Codex.');

	emitTally(onEvent, {
		cost: undefined,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens: undefined,
	});
	return stripFences(finalText);
}

function emitCodexItemStarted(
	item: {type: string; command?: string; server?: string; tool?: string},
	onEvent: (ev: LogEvent) => void,
) {
	if (item.type === 'command_execution' && item.command) {
		onEvent({kind: 'step', message: `Tool call: shell (${item.command})`});
	} else if (item.type === 'mcp_tool_call' && item.server && item.tool) {
		onEvent({
			kind: 'step',
			message: `Tool call: ${item.server}.${item.tool}`,
		});
	} else if (item.type === 'web_search') {
		onEvent({kind: 'step', message: 'Tool call: web_search'});
	}
}

function emitCodexItemCompleted(
	item: {
		type: string;
		status?: string;
		command?: string;
		changes?: Array<{path: string; kind: string}>;
		message?: string;
	},
	onEvent: (ev: LogEvent) => void,
) {
	if (item.type === 'command_execution' && item.status === 'failed') {
		onEvent({
			kind: 'warn',
			message: `Shell command failed${item.command ? `: ${item.command}` : ''}`,
		});
	} else if (item.type === 'file_change') {
		const count = item.changes?.length ?? 0;
		onEvent({
			kind: item.status === 'failed' ? 'warn' : 'step',
			message: `Codex reported ${count} file change${count === 1 ? '' : 's'}`,
		});
	} else if (item.type === 'error' && item.message) {
		onEvent({kind: 'warn', message: item.message});
	}
}

async function prepareCodexInput(
	input: AgentInput,
	pluginPath: string,
	makeTempDir: () => Promise<string>,
): Promise<{input: CodexInput; skillName: string | undefined}> {
	const skillName = extractSkillName(input);
	const promptParts: string[] = [];
	if (skillName) {
		promptParts.push(await codexSkillPrompt(pluginPath, skillName));
	}

	if (typeof input === 'string') {
		promptParts.push(input);
		return {input: promptParts.join('\n\n'), skillName};
	}

	const imageItems: CodexInputItem[] = [];
	let imageIndex = 0;
	for (const block of input) {
		if (block.type === 'text') {
			promptParts.push(block.text);
		} else if (block.type === 'image') {
			const dir = await makeTempDir();
			const path = join(dir, `image-${imageIndex++}.png`);
			await writeFile(path, Buffer.from(block.source.data, 'base64'));
			imageItems.push({type: 'local_image', path});
		}
	}

	const text = promptParts.join('\n\n');
	return {
		input:
			imageItems.length === 0 ? text : [{type: 'text', text}, ...imageItems],
		skillName,
	};
}

async function codexSkillPrompt(
	pluginPath: string,
	skillName: string,
): Promise<string> {
	const skillPath = join(pluginPath, 'skills', skillName, 'SKILL.md');
	let skillText: string;
	try {
		skillText = await readFile(skillPath, 'utf8');
	} catch (err) {
		throw new Error(
			`Codex provider could not load the "${skillName}" skill at ${skillPath}: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
	return [
		`Use the following Neptune skill instructions for this run.`,
		`<neptune_skill name="${skillName}">`,
		skillText.trim(),
		`</neptune_skill>`,
		`Follow that skill's output contract exactly. Do not modify files or call tools; Neptune will persist the returned content itself.`,
	].join('\n');
}

export function extractSkillName(input: AgentInput): string | undefined {
	const text =
		typeof input === 'string'
			? input
			: input
					.filter((block): block is TextBlock => block.type === 'text')
					.map(block => block.text)
					.join('\n');
	const match = /\bUse the ([a-z][a-z0-9-]*) skill\b/i.exec(text);
	return match?.[1]?.toLowerCase();
}

async function readProviderFromConfig(cwd: string): Promise<AgentProvider> {
	try {
		const raw = await readFile(join(cwd, CONFIG_FILENAME), 'utf8');
		const parsed = JSON.parse(raw) as {provider?: unknown};
		return normalizeAgentProvider(
			parsed.provider,
			`${CONFIG_FILENAME} provider`,
		);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'claude';
		throw err;
	}
}

type Tally = {
	cost: number | undefined;
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	cacheReadTokens: number | undefined;
	cacheCreationTokens: number | undefined;
};

// Emits a single 'usage' event carrying the SDK's reported tokens + cost.
// EventList renders it as a normal step row; aggregators (E2E) pick out
// the structured fields. The message preserves the previous human-
// readable form so single-call screens look the same as before.
//
// Note: every numeric field on the Tally is optional because the SDK
// may omit fields on non-success result subtypes (e.g. error_max_turns
// can return without a `total_cost_usd`). Aggregators that sum these
// can therefore undercount on partial failures — surface a "may be
// incomplete" caveat on summary screens whenever any agent call
// failed.
function emitTally(onEvent: (ev: LogEvent) => void, tally: Tally) {
	const parts: string[] = [];
	if (tally.outputTokens !== undefined)
		parts.push(`${tally.outputTokens} output tokens`);
	if (tally.cost !== undefined) parts.push(`$${tally.cost.toFixed(4)}`);
	onEvent({
		kind: 'usage',
		message:
			parts.length > 0
				? `Response complete (${parts.join(', ')})`
				: 'Response complete',
		costUsd: tally.cost,
		inputTokens: tally.inputTokens,
		outputTokens: tally.outputTokens,
		cacheReadInputTokens: tally.cacheReadTokens,
		cacheCreationInputTokens: tally.cacheCreationTokens,
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
