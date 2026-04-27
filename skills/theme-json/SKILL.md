---
name: theme-json
description: Generate theme.json from the linked Figma file's `🎨 Style Guide` layer and variable tables, for the neptune plugin. Use after dev-notes — writes a populated theme.json into the project theme directory.
---

1. Confirm the user has installed the WordPress Block Themes agent skill inside Studio (see https://developer.wordpress.com/docs/developer-tools/studio/agent-skills-wordpress-studio/) and that the Figma local MCP server is enabled in Claude Code. Load the `figma:figma-use` skill before pulling variable tables from Figma.

2. Read the Figma file ID from `neptune-config.json`. Use the Figma MCP to pull the variable tables from the file.

3. Find the `🎨 Style Guide` layer in the `🛠️  Dev Handoff` page in Figma. Cross-reference its visual base styles against the variable tables to build the style dataset (colors, typography, spacing, etc.) that theme.json needs.

4. Update `wordpress/wp-content/themes/<theme-slug>/theme.json` with the style dataset, where `<theme-slug>` is the `themeSlug` stored in `neptune-config.json`. Reference:
   - `wordpress/.agents/skills/wp-block-themes/SKILL.md` — how to update theme.json.
   - `wordpress/.agents/skills/wp-block-themes/references/theme-json.md` — theme.json structure and feature/block support.
   - `devNotes` in `neptune-config.json` — any style-relevant context the designer called out.

   If the Block Themes reference files do not exist, tell the user they need to install the Block Themes Studio agent skill before this skill can proceed.

5. If you have any follow-ups for the user, which are direct human actionable tasks. Open an issue for each on GitHub in the project repo, and link to the relevant section of the Figma file or the specific dev note that inspired the task. You'll use `gh issue create` for this, and you can find the repository URL and theme slug in `neptune-config.json` to construct the command. Note in the body text that the issue was create by Neptune.

6. Tell the user `theme.json` has been written and that the next skill in the flow is `map-design-templates`.
