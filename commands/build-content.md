---
description: Build the content for a WP_Post based on the content design given in Figma.
argument-hint: [template-or-part-name] [edit-url] [live-url]
---

Build the Post object relevant to the edit-url given in `$ARGUMENTS`. You will need to use the WP CLI via `studio wp` to update content via the relevant ID given in the edit URL.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- The `wp-blockmarkup` MCP — use it to generate WordPress block markup.
- The Figma MCP — Figma is the source of truth for the content design. Use `mcp__figma__get_design_context` against the relevant node ID under `templateMappings[…].figmaNodes` to pull the actual content design. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.