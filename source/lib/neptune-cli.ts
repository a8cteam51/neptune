// Wrapper around the `wp neptune ...` command suite registered by the
// active theme (see <theme>/inc/class-neptune-cli.php). Each command
// emits a single JSON object bracketed by Neptune sentinels; we
// extract and decode here so callers stay schema-driven and never
// hand-build PHP.
//
// Sentinel design: wp-cli output mixes deprecation notices, banners
// and ANSI cruft on the same stream as our payload. A unique
// open/close pair lets us locate the JSON regardless of preamble.
import {Buffer} from 'node:buffer';
import {shellSingleQuote, wpCli} from './wp-cli.js';
import type {StudioSession} from '../integrations/studio/mcp.js';
import {decode, type Decoder} from './decode.js';

const SENTINEL_RE = /@@NEPTUNE_OPEN@@([\s\S]*?)@@NEPTUNE_CLOSE@@/;
const FLAG_NAME_RE = /^[a-z][a-z0-9-]*$/;

export type NeptuneArg =
	| {kind: 'string'; value: string}
	| {kind: 'base64'; value: string};

export function strArg(value: string): NeptuneArg {
	return {kind: 'string', value};
}

// Pass arbitrary UTF-8 bytes (HTML, CSS, JSON) without worrying about
// shell or wp-cli arg parsing. The PHP side decodes the matching
// `--<name>-base64` flag.
export function b64Arg(value: string): NeptuneArg {
	return {
		kind: 'base64',
		value: Buffer.from(value, 'utf8').toString('base64'),
	};
}

// Builds a `neptune <subcommand> --flag=val ...` string for Studio's
// wp_cli MCP tool. Flag values are POSIX single-quoted; base64 args
// get a `-base64` suffix on the flag name to match the PHP side.
export function buildNeptuneCommand(
	subcommand: string,
	args: Record<string, NeptuneArg> = {},
): string {
	const parts: string[] = ['neptune', subcommand];
	for (const [name, arg] of Object.entries(args)) {
		if (!FLAG_NAME_RE.test(name)) {
			throw new Error(`Invalid neptune-cli flag name: ${name}`);
		}
		const flag = arg.kind === 'base64' ? `${name}-base64` : name;
		parts.push(`--${flag}=${shellSingleQuote(arg.value)}`);
	}
	return parts.join(' ');
}

export async function runNeptuneCli<T>(
	session: StudioSession,
	nameOrPath: string,
	subcommand: string,
	args: Record<string, NeptuneArg>,
	decoder: Decoder<T>,
): Promise<T> {
	const command = buildNeptuneCommand(subcommand, args);
	const out = await wpCli(session, nameOrPath, command);
	const match = SENTINEL_RE.exec(out);
	if (!match) {
		throw new Error(
			`wp neptune ${subcommand}: missing sentinel in output. First 200 chars: ${out
				.slice(0, 200)
				.trim()}`,
		);
	}
	const body = match[1] ?? '';
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (err) {
		throw new Error(
			`wp neptune ${subcommand}: invalid JSON in sentinel payload: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
	return decode(decoder, parsed, `wp neptune ${subcommand}`);
}
