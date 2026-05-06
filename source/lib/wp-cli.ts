// Thin wrapper around Studio MCP's `wp_cli` tool. Callers open a
// StudioSession once (via openStudioSession) and run multiple commands
// against it — each call is one wp-cli invocation against the named
// site. Returns the wp-cli stdout text; throws on non-zero/MCP error.
import {isToolError, joinToolText} from '../integrations/studio/mcp.js';
import type {StudioSession} from '../integrations/studio/mcp.js';

export async function wpCli(
	session: StudioSession,
	nameOrPath: string,
	command: string,
): Promise<string> {
	const resp = await session.call('wp_cli', {nameOrPath, command});
	if (resp.error) {
		throw new Error(`wp_cli error: ${resp.error.message}`);
	}
	const text = joinToolText(resp);
	if (isToolError(resp)) {
		throw new Error(`wp_cli failed: ${text}`);
	}
	return text;
}

// POSIX single-quote escape: wraps the value in single quotes and
// terminates any embedded single quote so the receiver gets the raw
// bytes intact. Safe for use inside any shell that splits on quoted
// strings.
export function shellSingleQuote(value: string): string {
	return "'" + value.replace(/'/g, "'\\''") + "'";
}
