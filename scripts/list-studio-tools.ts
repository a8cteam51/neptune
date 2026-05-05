// Spawns `studio mcp` and prints the list of tools it advertises.
// Requires `studio` CLI on PATH. Run with:
//   npx tsx scripts/list-studio-tools.ts
import {openStudioSession} from '../source/integrations/studio/mcp.js';

async function main() {
	const session = await openStudioSession();
	try {
		const tools = await session.listTools();
		console.log(`Studio MCP advertises ${tools.length} tool(s):\n`);
		for (const tool of tools) {
			console.log(`• ${tool.name}`);
			if (tool.description) {
				const lines = tool.description.split('\n');
				for (const line of lines) console.log(`    ${line}`);
			}
			if (tool.inputSchema) {
				console.log(
					`    inputSchema: ${JSON.stringify(tool.inputSchema, null, 2)
						.split('\n')
						.join('\n    ')}`,
				);
			}
			console.log();
		}
	} finally {
		session.close();
	}
}

main().catch(err => {
	console.error('Failed to list Studio MCP tools:', err);
	process.exit(1);
});
