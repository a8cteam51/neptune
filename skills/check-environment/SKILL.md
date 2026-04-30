---
name: check-environment
description: Verifies the local environment for the Neptune plugin (WordPress Studio CLI, Figma MCP, GitHub CLI, Team51 CLI, jq) before any other Neptune skill or command runs. Used at the start of a new Team 51 WordPress block-theme build. Triggers on phrases like "start a new Team 51 site", "begin a new theme project", "kick off a Neptune build", "check my environment", "check my MCPs", or "preflight before building".
---

1. Greet the user briefly and list the skill flow for this plugin. Skills auto-chain — each skill flows directly into the next when it completes. Slash commands at the end of the chain are run manually per template:
   - `check-environment` — environment check (this skill).
   - `setup-project` — scaffold the project directory, clone the theme repo, stand up a Studio WordPress site, and capture the Figma dev-handoff page URL.
   - `pull-figma` — walk the Figma dev-handoff page once and extract every structural slice Neptune needs (template candidates, style-guide pointer, theme assets, dev notes, variable definitions) into `neptune-config.json`.
   - `map-design-templates` — confirm each template-mapping candidate with the user and scaffold empty theme files. (No Figma walking — reads candidates from config.)
   - `theme-json` — generate `theme.json` from `figmaVariables` in config plus a targeted `get_design_context` call on the style-guide node, and register custom templates / template parts from the mappings.
   - `extract-patterns` — find Figma components used across multiple layouts and lift them into WP block patterns. (Reads layout node ids from config; no manual Figma navigation.)
   - `/build-template <name>` — slash command; populate one template or part wrapper with block markup.
   - `/build-content <name>` — slash command; fill the body of one WP_Post / WP_Page from its Figma design.
   - `/refine-template <name> <site-url>` — slash command; visual-diff rendered template wrapper against Figma and refine.
   - `/refine-content <name> <page-url>` — slash command; visual-diff rendered post body against Figma and refine.

2. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-studio-install.sh`. If it fails, point the user at https://developer.wordpress.com/studio/.

3. Confirm the Figma local MCP is reachable. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-figma-mcp.sh`. If it fails, follow the instructions the script prints — the user needs Figma desktop running with the local Dev Mode MCP server enabled. Neptune does not use Figma's hosted MCP, only the local one.

4. Confirm the `wordpress-studio` MCP server is enabled. The plugin ships it in `.mcp.json`; confirm the user has approved it in Claude Code's MCP server enablement (`/mcp` lists enabled servers). If the user has not enabled it, ask them to do so before continuing — `/build-*`, `/refine-*`, and `extract-patterns` all depend on it (block-markup validation now goes through `mcp__wordpress-studio__validate_blocks`; performance and SEO sanity checks use `need_for_speed` and `rank_me_up`).

5. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-github-cli.sh`. If it fails, follow the instructions the script prints.

6. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-team51-cli.sh`. If it fails, point the user at the Team51 CLI repository.

7. Verify `jq` is installed (`command -v jq`). The state-gate script `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh` depends on it. If missing, point the user at https://jqlang.org/.

Once all checks pass, load and follow the `setup-project` skill to continue.
