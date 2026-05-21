// Haydi MCP server descriptor for the Claude Agent SDK.
//
// Build / refine commands hand the agent SDK an HTTP MCP server pointed
// at the project's running site. The agent then sees Haydi's tools
// (run_php, run_query, write_file, edit_file, etc.) as
// `mcp__haydi__<tool_name>` and uses them per the pull-writer skill's
// recipes. The HTTP transport is what Haydi exposes at
// `/wp-json/haydi/v1/mcp`; the Bearer token serves as the approval gate
// (see haydi/includes/class-rest-api.php — "the token itself acts as
// the approval gate, equivalent to a human clicking Approve").
import type {HaydiConfig} from '../commands/setup-project/types.js';

// Stable server name used inside the SDK's mcpServers map AND for the
// SDK's tool-prefix convention. Keep aligned with the prefix used in
// HAYDI_TOOL_ALLOWLIST below.
export const HAYDI_SERVER_NAME = 'haydi';

// MCP tools the build / refine subagents are allowed to call. Whitelist
// not blacklist, so a future Haydi release adding (say) a destructive
// admin tool doesn't silently widen Neptune's surface. Read tools and
// the four write surfaces the pull-writer skill needs.
//
// Naming: the SDK prefixes every MCP tool with `mcp__<server>__`, and
// Haydi's own tool names already start with `haydi_`. The two stack —
// the surface-level tool the agent calls is `mcp__haydi__haydi_run_php`,
// not `mcp__haydi__run_php`. If you add tools, copy the exact name from
// Haydi's `tools/list` response and prefix `mcp__haydi__`.
export const HAYDI_TOOL_ALLOWLIST: readonly string[] = [
	'mcp__haydi__haydi_run_php',
	'mcp__haydi__haydi_run_query',
	'mcp__haydi__haydi_read_file',
	'mcp__haydi__haydi_write_file',
	'mcp__haydi__haydi_edit_file',
	'mcp__haydi__haydi_list_files',
	'mcp__haydi__haydi_search_files',
	'mcp__haydi__haydi_list_backups',
	'mcp__haydi__haydi_list_extensions',
	'mcp__haydi__haydi_get_allowed_roots',
];

// Shape compatible with the SDK's McpHttpServerConfig — declared
// locally so this module doesn't import the SDK at type-check time.
// The SDK validates the shape when it consumes the value.
type HttpMcpServer = {
	type: 'http';
	url: string;
	headers: Record<string, string>;
};

export function haydiMcpServers(
	config: HaydiConfig,
): Record<string, HttpMcpServer> {
	if (!config.token) {
		throw new Error(
			'Haydi token is missing from neptune-config.json — cannot attach the Haydi MCP server. Paste the Bearer token from WP Admin → Haydi → Remote Access into the haydi.token field.',
		);
	}
	return {
		[HAYDI_SERVER_NAME]: {
			type: 'http',
			url: `${config.url}/wp-json/haydi/v1/mcp`,
			headers: {
				Authorization: `Bearer ${config.token}`,
			},
		},
	};
}
