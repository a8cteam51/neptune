// Figma Dev Mode MCP client. Talks to the local server bundled with Figma
// desktop (default http://127.0.0.1:3845/mcp). Three concerns live here:
//   - session/transport (initializeSession, mcpCall, openMcpSession)
//   - the high-level pullFromFigma generator that writes one pull's
//     artifacts (code.tsx, variables.json, metadata.xml, screenshot.png)
//   - LLM-instruction stripping for code.tsx / metadata.xml tails
// Note: the local Dev Mode server is a different runtime from Figma's
// public REST API, so its 429 response shape may not match the documented
// headers — FigmaRateLimitError captures whatever it emits.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Buffer} from 'node:buffer';
import type {LogEvent} from '../../lib/event-list.js';

const MCP_URL = process.env['FIGMA_MCP_URL'] ?? 'http://127.0.0.1:3845/mcp';
const PROTOCOL_VERSION = '2025-06-18';

export type PullOptions = {
	pageName: string;
	nodeRef: string;
	outRoot?: string;
};

type JsonRpcRequest = {
	jsonrpc: '2.0';
	id?: number;
	method: string;
	params?: unknown;
};

type JsonRpcResponse = {
	jsonrpc: '2.0';
	id?: number;
	result?: any;
	error?: {code: number; message: string};
};

export type SelectionMetadata = {
	rawXml: string;
	name?: string;
	x?: number;
	y?: number;
};

export class FigmaRateLimitError extends Error {
	status: number;
	headers: Record<string, string>;
	body: string;
	retryAfterSec?: number;
	planTier?: string;
	rateLimitType?: string;
	upgradeLink?: string;

	constructor(status: number, respHeaders: Headers, body: string) {
		const headers: Record<string, string> = {};
		for (const [k, v] of respHeaders) headers[k] = v;

		const retryAfterRaw = respHeaders.get('retry-after');
		const retryAfterSec =
			retryAfterRaw && Number.isFinite(Number(retryAfterRaw))
				? Number(retryAfterRaw)
				: undefined;
		const rateLimitType =
			respHeaders.get('x-figma-rate-limit-type') ?? undefined;
		const planTier = respHeaders.get('x-figma-plan-tier') ?? undefined;
		const upgradeLink =
			respHeaders.get('x-figma-upgrade-link') ?? undefined;

		const parts = [`Figma rate limit (HTTP ${status})`];
		if (rateLimitType) parts.push(`type: ${rateLimitType}`);
		if (retryAfterSec !== undefined)
			parts.push(`retry after ${retryAfterSec}s`);
		if (body) {
			const trimmed = body.length > 200 ? body.slice(0, 200) + '…' : body;
			parts.push(`body: ${trimmed}`);
		}

		super(parts.join(' | '));
		this.name = 'FigmaRateLimitError';
		this.status = status;
		this.headers = headers;
		this.body = body;
		this.retryAfterSec = retryAfterSec;
		this.rateLimitType = rateLimitType;
		this.planTier = planTier;
		this.upgradeLink = upgradeLink;
	}
}

export type SelectionResult =
	| {ok: true; selection: SelectionMetadata | null}
	| {ok: false; error: Error};

export async function getSelectionMetadata(): Promise<SelectionResult> {
	try {
		const sessionId = await initializeSession();
		const resp = await mcpCall(sessionId, {
			jsonrpc: '2.0',
			id: 99,
			method: 'tools/call',
			params: {name: 'get_metadata', arguments: {}},
		});

		if (resp?.error) {
			return {
				ok: false,
				error: new Error(`MCP error ${resp.error.code}: ${resp.error.message}`),
			};
		}
		if (resp?.result?.isError === true) {
			return {ok: false, error: new Error('MCP returned isError=true')};
		}

		const content: Array<{type: string; text?: string}> =
			resp?.result?.content ?? [];
		const text = content
			.filter(c => c.type === 'text' && typeof c.text === 'string')
			.map(c => c.text)
			.join('\n')
			.trim();

		if (text === '') return {ok: true, selection: null};
		return {ok: true, selection: parseSelectionMetadata(text)};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err : new Error(String(err)),
		};
	}
}

function parseSelectionMetadata(rawXml: string): SelectionMetadata {
	const firstLine =
		rawXml.split('\n').find(line => line.trim() !== '') ?? '';
	const meta: SelectionMetadata = {rawXml};

	const nameMatch = /\sname="([^"]*)"/.exec(firstLine);
	if (nameMatch) meta.name = nameMatch[1];

	const xValue = readNumericAttr(firstLine, 'x');
	if (xValue !== undefined) meta.x = xValue;

	const yValue = readNumericAttr(firstLine, 'y');
	if (yValue !== undefined) meta.y = yValue;

	return meta;
}

function readNumericAttr(line: string, attr: string): number | undefined {
	const match = new RegExp(`\\s${attr}="([^"]*)"`).exec(line);
	if (!match) return undefined;
	const value = Number(match[1]);
	return Number.isFinite(value) ? Math.round(value) : undefined;
}

export async function* pullFromFigma(
	session: McpSession,
	opts: PullOptions,
): AsyncGenerator<LogEvent> {
	const {pageName, nodeRef, outRoot = './design/pages'} = opts;
	const outDir = join(outRoot, pageName);
	await mkdir(outDir, {recursive: true});

	const args: Record<string, string> = !nodeRef
		? {}
		: nodeRef.startsWith('http')
			? {nodeUrl: nodeRef}
			: {nodeId: nodeRef};

	const textTools: Array<[string, string]> = [
		['get_design_context', 'code.tsx'],
		['get_variable_defs', 'variables.json'],
		['get_metadata', 'metadata.xml'],
	];

	for (const [tool, file] of textTools) {
		yield {kind: 'step', message: `${tool} -> ${file}`};
		const resp = await session.call(tool, args);
		const content: Array<{type: string; text?: string}> =
			resp?.result?.content ?? [];
		const text = content
			.filter(c => c.type === 'text' && typeof c.text === 'string')
			.map(c => c.text)
			.join('\n');
		const cleaned = stripLlmInstructions(file, text);
		await writeFile(
			join(outDir, file),
			cleaned === '' ? JSON.stringify(resp, null, 2) : cleaned,
		);
	}

	yield {kind: 'step', message: 'get_screenshot -> screenshot.png'};
	const shotResp = await session.call('get_screenshot', args);
	const shotContent: Array<{type: string; data?: string}> =
		shotResp?.result?.content ?? [];
	const imageBlock = shotContent.find(c => c.type === 'image');
	if (imageBlock?.data) {
		await writeFile(
			join(outDir, 'screenshot.png'),
			Buffer.from(imageBlock.data, 'base64'),
		);
	} else {
		yield {
			kind: 'warn',
			message: 'No image content in screenshot response.',
		};
	}

	yield {kind: 'step', message: `Done. Artifacts in: ${outDir}`};
}

// Figma's MCP tools append guidance text aimed at downstream LLMs (e.g.
// "SUPER CRITICAL: convert this React+Tailwind to your stack…"). We strip
// it so the saved files contain only the actual artifact. Markers are
// anchored to line start; if Figma changes the wording, the strip silently
// stops working and the tail re-appears in saved files.
const LLM_INSTRUCTION_MARKERS: Record<string, RegExp> = {
	'code.tsx': /^SUPER CRITICAL: The generated React/m,
	'metadata.xml': /^IMPORTANT: After you call this tool/m,
};

export function stripLlmInstructions(file: string, text: string): string {
	const marker = LLM_INSTRUCTION_MARKERS[file];
	if (!marker) return text;
	const match = marker.exec(text);
	if (!match) return text;
	const head = text.slice(0, match.index).replace(/\s+$/, '');
	return head === '' ? '' : head + '\n';
}

export type McpSession = {
	call: (
		name: string,
		args: Record<string, string>,
	) => Promise<JsonRpcResponse | undefined>;
};

export async function openMcpSession(): Promise<McpSession> {
	const sessionId = await initializeSession();
	let nextId = 1000;
	return {
		call: (name, args) =>
			mcpCall(sessionId, {
				jsonrpc: '2.0',
				id: nextId++,
				method: 'tools/call',
				params: {name, arguments: args},
			}),
	};
}

export function joinTextContent(resp: JsonRpcResponse | undefined): string {
	const content: Array<{type: string; text?: string}> =
		resp?.result?.content ?? [];
	return content
		.filter(c => c.type === 'text' && typeof c.text === 'string')
		.map(c => c.text)
		.join('\n');
}

async function initializeSession(): Promise<string> {
	const initResp = await fetch(MCP_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'MCP-Protocol-Version': PROTOCOL_VERSION,
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: {name: 'neptune-figma-pull', version: '0.1'},
			},
		} satisfies JsonRpcRequest),
	});

	if (initResp.status === 429) {
		const body = await initResp.text();
		throw new FigmaRateLimitError(initResp.status, initResp.headers, body);
	}

	const sessionId = initResp.headers.get('mcp-session-id');
	const initText = await initResp.text();
	if (!sessionId) {
		throw new Error(
			`No Mcp-Session-Id returned. Is Figma desktop running with Dev Mode MCP enabled?\n${initText}`,
		);
	}

	await mcpCall(sessionId, {
		jsonrpc: '2.0',
		method: 'notifications/initialized',
	});

	return sessionId;
}

// Single MCP request. Notifications (no `id`) return undefined; everything
// else is parsed from either JSON or text/event-stream. The SSE branch
// assumes one `data: ` line per response — works for current Figma Dev
// Mode but isn't a general-purpose SSE reader.
async function mcpCall(
	sessionId: string,
	payload: JsonRpcRequest,
): Promise<JsonRpcResponse | undefined> {
	const resp = await fetch(MCP_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			'Mcp-Session-Id': sessionId,
			'MCP-Protocol-Version': PROTOCOL_VERSION,
		},
		body: JSON.stringify(payload),
	});

	if (resp.status === 429) {
		const body = await resp.text();
		throw new FigmaRateLimitError(resp.status, resp.headers, body);
	}

	const text = await resp.text();

	if (payload.id === undefined) {
		return undefined;
	}

	const ct = resp.headers.get('content-type') ?? '';
	if (ct.includes('text/event-stream') || /(^|\n)data: /.test(text)) {
		for (const line of text.split('\n')) {
			if (line.startsWith('data: ')) {
				return JSON.parse(line.slice('data: '.length)) as JsonRpcResponse;
			}
		}
	}

	return JSON.parse(text) as JsonRpcResponse;
}
