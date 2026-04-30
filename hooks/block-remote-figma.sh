#!/usr/bin/env bash

cat >&2 <<'EOF'
Neptune blocks the remote Figma MCP (mcp__figma__*).

Use the local equivalent: mcp__figma-local__*. It talks to Figma desktop's
Dev Mode MCP server at http://127.0.0.1:3845/mcp. Neptune ships an .mcp.json
that registers it, and the check-environment skill verifies it is reachable.

If the local server is not running, open Figma desktop and enable:
  Figma menu -> Preferences -> Enable local MCP server
  https://developers.figma.com/docs/figma-mcp-server/local-server-installation/
EOF
exit 2
