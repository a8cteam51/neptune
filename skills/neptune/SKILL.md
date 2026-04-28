---
name: neptune
description: Start-of-project environment check for the neptune plugin. Use at the start of a Team 51 site build, before any other plugin skill runs — verifies WordPress Studio CLI, Figma MCP, GitHub CLI, and Team51 CLI are installed and authenticated, then points the user at the next skill in the flow.
---

1. Greet the user briefly and list the manual skill flow for this plugin. Each skill is invoked by the user, in order:
   - `neptune` — environment check (this skill).
   - `setup-project` — scaffold the project directory, clone the theme repo, stand up a Studio WordPress site.
   - `dev-notes` — pull `💬 Dev Note` components from Figma into `neptune-config.json`.
   - `map-design-templates` — map Figma `🗒️ Templates` title cards to WordPress theme files and create empty files.
   - `download-assets` — export every image asset from the desktop layouts, save to `/assets/`, import into the WP media library, and record the Figma-image-to-WP-attachment map in `neptune-config.json`.
   - `theme-json` — generate `theme.json` from the Figma `🎨 Style Guide` and variable tables, and register custom templates / template parts from the mappings recorded above.
   - `/build-template <name>` — slash command; populate one template or part with block markup.
   - `/refine-template <name> <site-url>` — slash command; visual-diff rendered output against Figma and refine.

2. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-studio-install.sh`. If it fails, point the user at https://developer.wordpress.com/studio/.

3. Confirm the Figma MCP is reachable. If it is not, point the user at https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#claude-code.

4. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-github-cli.sh`. If it fails, follow the instructions the script prints.

5. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-team51-cli.sh`. If it fails, point the user at the Team51 CLI repository.

Once all checks pass, tell the user the next step is the `setup-project` skill. Do not auto-invoke it.
