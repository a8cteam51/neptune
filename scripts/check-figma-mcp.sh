#!/usr/bin/env bash

set -euo pipefail

URL="http://127.0.0.1:3845/mcp"

response=$(curl -sS -m 3 \
	-H "Accept: application/json, text/event-stream" \
	-H "Content-Type: application/json" \
	-X POST \
	-d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"neptune-check","version":"0"}}}' \
	"$URL" 2>&1) || {
	echo "Figma local MCP is not reachable at $URL"
	echo
	echo "Open the Figma desktop app, then enable the local Dev Mode MCP server:"
	echo "  Figma menu → Preferences → Enable local MCP server"
	echo "  https://developers.figma.com/docs/figma-mcp-server/local-server-installation/"
	echo
	echo "Neptune requires the local MCP — it does not use Figma's hosted MCP."
	exit 1
}

if ! echo "$response" | grep -q '"protocolVersion"'; then
	echo "Figma local MCP responded but the handshake failed:"
	echo "$response" | head -5
	echo
	echo "Restart Figma desktop and re-enable the local Dev Mode MCP server."
	exit 1
fi

echo "Figma local MCP reachable at $URL"
