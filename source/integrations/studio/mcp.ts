// WordPress Studio MCP client. Spawned as a stdio subprocess (`studio mcp`)
// and driven via newline-delimited JSON-RPC. Different transport from the
// Figma MCP (HTTP) but the same MCP semantics — initialize, then
// tools/call.
//
// Used for `validate_blocks` (per-block save() validation) and
// `take_screenshot` (full-page render at the desktop or mobile preset).
// Both require the named site to be running.
import {type ChildProcess} from 'node:child_process';
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {
	attachAbortSignal,
	trackChild,
} from '../../lib/process-tracker.js';
import {defaultSpawn, type Spawn} from '../../lib/spawn.js';

const PROTOCOL_VERSION = '2025-06-18';
const REQUEST_TIMEOUT_MS = 60_000;

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

export type StudioSession = {
	call: (
		name: string,
		args: Record<string, unknown>,
	) => Promise<JsonRpcResponse>;
	close: () => void;
};

export type StudioSessionOptions = {
	signal?: AbortSignal;
	spawn?: Spawn;
};

export async function openStudioSession(
	options: StudioSessionOptions = {},
): Promise<StudioSession> {
	const {signal, spawn = defaultSpawn} = options;
	let child: ChildProcess;
	try {
		child = spawn('studio', ['mcp'], {stdio: ['pipe', 'pipe', 'pipe']});
	} catch (err) {
		throw wrapSpawnError(err);
	}
	const stdin = child.stdin;
	const stdout = child.stdout;
	if (!stdin || !stdout) {
		throw new Error('studio mcp child has no stdio pipes');
	}
	trackChild(child);
	attachAbortSignal(child, signal);

	let nextId = 1;
	let buf = '';
	const pending = new Map<
		number,
		{
			resolve: (resp: JsonRpcResponse) => void;
			reject: (err: Error) => void;
			timer: NodeJS.Timeout;
		}
	>();
	let closed = false;
	let spawnErr: Error | null = null;

	const failAll = (err: Error) => {
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(err);
		}
		pending.clear();
	};

	child.on('error', err => {
		spawnErr = wrapSpawnError(err);
		failAll(spawnErr);
	});

	child.on('exit', () => {
		if (!closed) {
			closed = true;
			failAll(new Error('studio mcp process exited unexpectedly'));
		}
	});

	stdout.on('data', (chunk: Buffer) => {
		buf += chunk.toString('utf8');
		let nl: number;
		while ((nl = buf.indexOf('\n')) !== -1) {
			const line = buf.slice(0, nl);
			buf = buf.slice(nl + 1);
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line) as JsonRpcResponse;
				if (typeof msg.id === 'number') {
					const entry = pending.get(msg.id);
					if (entry) {
						clearTimeout(entry.timer);
						pending.delete(msg.id);
						entry.resolve(msg);
					}
				}
			} catch {
				/* ignore non-JSON lines */
			}
		}
	});

	const send = (req: JsonRpcRequest): Promise<JsonRpcResponse> =>
		new Promise<JsonRpcResponse>((resolve, reject) => {
			if (closed) {
				reject(new Error('studio mcp session is closed'));
				return;
			}
			if (spawnErr) {
				reject(spawnErr);
				return;
			}
			const isRequest = req.id !== undefined;
			if (isRequest) {
				const id = req.id!;
				const timer = setTimeout(() => {
					if (pending.delete(id)) {
						reject(
							new Error(
								`studio mcp request ${req.method} timed out after ${REQUEST_TIMEOUT_MS}ms`,
							),
						);
					}
				}, REQUEST_TIMEOUT_MS);
				timer.unref();
				pending.set(id, {resolve, reject, timer});
			}
			stdin.write(JSON.stringify(req) + '\n', err => {
				if (err) {
					if (isRequest) {
						const entry = pending.get(req.id!);
						if (entry) {
							clearTimeout(entry.timer);
							pending.delete(req.id!);
						}
					}
					reject(err);
				}
			});
			if (!isRequest) {
				resolve({jsonrpc: '2.0'});
			}
		});

	const initResp = await send({
		jsonrpc: '2.0',
		id: nextId++,
		method: 'initialize',
		params: {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: {name: 'neptune-studio-validate', version: '0.1'},
		},
	});
	if (initResp.error) {
		killChild(child);
		throw new Error(
			`studio mcp initialize failed: ${initResp.error.message}`,
		);
	}
	await send({jsonrpc: '2.0', method: 'notifications/initialized'});

	return {
		call: (name, args) =>
			send({
				jsonrpc: '2.0',
				id: nextId++,
				method: 'tools/call',
				params: {name, arguments: args},
			}),
		close: () => {
			if (closed) return;
			closed = true;
			failAll(new Error('studio mcp session closed by caller'));
			killChild(child);
		},
	};
}

function killChild(child: ChildProcess) {
	try {
		child.kill('SIGTERM');
		setTimeout(() => {
			if (child.exitCode === null && child.signalCode === null) {
				try {
					child.kill('SIGKILL');
				} catch {
					/* best effort */
				}
			}
		}, 2000).unref();
	} catch {
		/* best effort */
	}
}

export type ValidationResult =
	| {ok: true; total: number; raw: string}
	| {
			ok: false;
			valid: number;
			total: number;
			issues: string;
			raw: string;
	  };

export async function validateBlocks(
	session: StudioSession,
	nameOrPath: string,
	content: string,
): Promise<ValidationResult> {
	const resp = await session.call('validate_blocks', {nameOrPath, content});
	if (resp.error) {
		throw new Error(`validate_blocks error: ${resp.error.message}`);
	}
	const text = joinTextContent(resp);
	if (resp.result?.isError === true) {
		throw new Error(
			`validate_blocks returned isError. Is the site running?\n${text}`,
		);
	}

	const m = /Validation:\s*(\d+)\/(\d+)\s+blocks?\s+valid/i.exec(text);
	if (!m) {
		throw new Error(`Unexpected validate_blocks response:\n${text}`);
	}

	const valid = Number(m[1]);
	const total = Number(m[2]);
	if (valid === total) {
		return {ok: true, total, raw: text};
	}

	const idx = text.indexOf('Invalid blocks:');
	const issues = idx === -1 ? text : text.slice(idx).trim();
	return {ok: false, valid, total, issues, raw: text};
}

export type ScreenshotViewport = 'desktop' | 'mobile';

export async function takeScreenshot(
	session: StudioSession,
	url: string,
	viewport: ScreenshotViewport = 'desktop',
): Promise<Buffer> {
	const resp = await session.call('take_screenshot', {url, viewport});
	if (resp.error) {
		throw new Error(`take_screenshot error: ${resp.error.message}`);
	}
	if (resp.result?.isError === true) {
		throw new Error(
			`take_screenshot returned isError. Is the site running?\n${joinTextContent(resp)}`,
		);
	}
	const content: Array<{
		type: string;
		data?: string;
		mimeType?: string;
		text?: string;
	}> = resp.result?.content ?? [];
	const img = content.find(c => c.type === 'image' && c.data);
	if (!img?.data) {
		throw new Error(
			`take_screenshot returned no image block:\n${joinTextContent(resp)}`,
		);
	}
	return Buffer.from(img.data, 'base64');
}

// Studio's `~/.studio/cli.json` lists every registered site with its
// path + assigned port. We map the project's wordpress/ dir to a port,
// returning the running URL. Used because `studio mcp`'s `site_info`
// tool currently hangs in some Studio versions; reading the file is
// fast and stable.
export async function getSiteUrlFromStudioConfig(
	projectDir: string,
	configPath?: string,
): Promise<string | null> {
	const cliConfigPath = configPath ?? resolve(homedir(), '.studio', 'cli.json');
	let raw: string;
	try {
		raw = await readFile(cliConfigPath, 'utf8');
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	const sites = (parsed as {sites?: Array<{path?: string; port?: number}>})
		.sites;
	if (!Array.isArray(sites)) return null;

	const wpDir = resolve(projectDir, 'wordpress');
	const match = sites.find(
		s => typeof s.path === 'string' && resolve(s.path) === wpDir,
	);
	if (!match || typeof match.port !== 'number') return null;
	return `http://localhost:${match.port}`;
}

function joinTextContent(resp: JsonRpcResponse): string {
	const content: Array<{type: string; text?: string}> =
		resp?.result?.content ?? [];
	return content
		.filter(c => c.type === 'text' && typeof c.text === 'string')
		.map(c => c.text)
		.join('\n');
}

function wrapSpawnError(err: unknown): Error {
	if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
		return new Error(
			"`studio` CLI not found on PATH. Install WordPress Studio's CLI first.",
		);
	}
	return err instanceof Error ? err : new Error(String(err));
}
