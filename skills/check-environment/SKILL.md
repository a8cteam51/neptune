---
name: check-environment
description: Verifies the local environment for the Neptune plugin (WordPress Studio CLI, Figma MCP, GitHub CLI, Team51 CLI, jq) before any other Neptune skill or command runs. Used at the start of a new Team 51 WordPress block-theme build. Triggers on phrases like "start a new Team 51 site", "begin a new theme project", "kick off a Neptune build", "check my environment", "check my MCPs", or "preflight before building".
model: sonnet
---

1. Greet the user briefly and list the manual skill flow for this plugin. The user invokes each step explicitly — auto-chaining between skills is opt-in (each skill ends by *offering* the next; it does not auto-invoke):
   - `check-environment` — environment check (this skill).
   - `setup-project` — scaffold the project directory, clone the theme repo, stand up a Studio WordPress site.
   - `dev-notes` — pull `💬 Dev Note` components from Figma into `neptune-config.json`.
   - `map-design-templates` — map Figma `🗒️ Templates` title cards to WordPress theme files and create empty files.
   - `theme-json` — generate `theme.json` from the Figma `🎨 Style Guide` and variable tables, and register custom templates / template parts from the mappings recorded above.
   - `extract-patterns` — register reusable Figma components as WP block patterns under `patterns/` so `/build-*` runs reference them by slug instead of re-emitting markup.
   - `/build-template <name>` — slash command; populate one template or part wrapper with block markup.
   - `/build-content <name>` — slash command; fill the body of one WP_Post / WP_Page from its Figma design.
   - `/refine-template <name> <site-url>` — slash command; visual-diff rendered template wrapper against Figma and refine.
   - `/refine-content <name> <page-url>` — slash command; visual-diff rendered post body against Figma and refine.
   - Batch wrappers: `/build-all-templates`, `/build-all-content`, `/refine-all-templates`, `/refine-all-content`.

2. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-studio-install.sh`. If it fails, point the user at https://developer.wordpress.com/studio/.

3. Confirm the Figma MCP is reachable. Call `mcp__figma__whoami` (it requires no arguments and returns immediately if the server is up). If the call errors, point the user at https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#claude-code.

4. Confirm the `wordpress-studio` MCP server is enabled. The plugin ships it in `.mcp.json`; confirm the user has approved it in Claude Code's MCP server enablement (`/mcp` lists enabled servers). If the user has not enabled it, ask them to do so before continuing — `/build-*`, `/refine-*`, and `extract-patterns` all depend on it (block-markup validation now goes through `mcp__wordpress-studio__validate_blocks`; performance and SEO sanity checks use `need_for_speed` and `rank_me_up`).

5. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-github-cli.sh`. If it fails, follow the instructions the script prints.

6. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-team51-cli.sh`. If it fails, point the user at the Team51 CLI repository.

7. Verify `jq` is installed (`command -v jq`). The state-gate script `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh` depends on it. If missing, point the user at https://jqlang.org/.

Once all checks pass, tell the user the next step is the `setup-project` skill. Do not auto-invoke it.
