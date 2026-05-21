import test from 'ava';
import {
	HAYDI_SERVER_NAME,
	HAYDI_TOOL_ALLOWLIST,
	haydiMcpServers,
} from '../../source/lib/haydi-mcp.js';

test('haydiMcpServers: keys the SDK record by stable server name', t => {
	const servers = haydiMcpServers({
		url: 'http://localhost:8893',
		token: 'tok',
	});
	t.deepEqual(Object.keys(servers), [HAYDI_SERVER_NAME]);
});

test('haydiMcpServers: appends /wp-json/haydi/v1/mcp to the site url', t => {
	const servers = haydiMcpServers({
		url: 'http://localhost:8893',
		token: 'tok',
	});
	t.is(
		servers[HAYDI_SERVER_NAME]!.url,
		'http://localhost:8893/wp-json/haydi/v1/mcp',
	);
});

test('haydiMcpServers: sets the Bearer header verbatim', t => {
	const servers = haydiMcpServers({
		url: 'http://localhost:8893',
		token: 'abc123',
	});
	t.is(servers[HAYDI_SERVER_NAME]!.headers['Authorization'], 'Bearer abc123');
});

test('haydiMcpServers: uses http transport (SDK McpHttpServerConfig)', t => {
	const servers = haydiMcpServers({
		url: 'http://localhost:8893',
		token: 'tok',
	});
	t.is(servers[HAYDI_SERVER_NAME]!.type, 'http');
});

test('HAYDI_TOOL_ALLOWLIST includes haydi_run_php and haydi_run_query', t => {
	t.true(HAYDI_TOOL_ALLOWLIST.includes('mcp__haydi__haydi_run_php'));
	t.true(HAYDI_TOOL_ALLOWLIST.includes('mcp__haydi__haydi_run_query'));
});

test('HAYDI_TOOL_ALLOWLIST entries all share the mcp__haydi__haydi_ prefix', t => {
	// SDK prefix `mcp__<server>__` stacks on Haydi's own `haydi_` prefix.
	for (const tool of HAYDI_TOOL_ALLOWLIST) {
		t.true(
			tool.startsWith('mcp__haydi__haydi_'),
			`tool ${tool} missing mcp__haydi__haydi_ prefix`,
		);
	}
});
