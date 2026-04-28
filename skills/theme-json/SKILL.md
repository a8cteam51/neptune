---
name: theme-json
description: Generates theme.json from the Figma file's `🎨 Style Guide` layer and variable tables (palette, typography, spacing) and registers the template parts and custom templates captured by `map-design-templates`. Used after map-design-templates — writes a populated theme.json into the project theme directory. Triggers on phrases like "generate theme.json", "pull the style guide", "set up the design tokens", "register the template parts", or "wire up the color palette".
---

1. Confirm the user has installed the WordPress Block Themes agent skill inside Studio (see https://developer.wordpress.com/docs/developer-tools/studio/agent-skills-wordpress-studio/) and that the Figma local MCP server is enabled in Claude Code. Load the `figma:figma-use` skill before pulling variable tables from Figma.

2. Read the Figma file ID from `neptune-config.json`. Use the Figma MCP to pull the variable tables from the file.

3. Find the `🎨 Style Guide` layer in the `🛠️  Dev Handoff` page in Figma. Cross-reference its visual base styles against the variable tables to build the style dataset (colors, typography, spacing, etc.) that theme.json needs.

4. Read `templateMappings` from `neptune-config.json` and derive the registrations theme.json needs:
   - **Template parts** — every entry whose `wordpressFile` lives under `parts/` (e.g. `parts/header.html`, `parts/footer.html`). Register each under `templateParts` with an `area` of `header`, `footer`, or `uncategorized` based on the file name; ask the user if the area is ambiguous.
   - **Custom templates** — every entry whose `wordpressFile` lives under `templates/` and is **not** one of the WordPress hierarchy defaults (`index.html`, `home.html`, `front-page.html`, `single.html`, `singular.html`, `page.html`, `archive.html`, `category.html`, `tag.html`, `author.html`, `date.html`, `taxonomy.html`, `search.html`, `404.html`, `attachment.html`). Register each under `customTemplates` with a human-readable `title` derived from the Figma title-card name and a sensible `postTypes` value (default `["page"]`; ask if unsure).
   When several `templateMappings` entries point at the same `wordpressFile`, register it once. If `templateMappings` is missing or empty, stop and tell the user to run `map-design-templates` first.

5. Update `wordpress/wp-content/themes/<theme-slug>/theme.json` with the style dataset from step 3 and the `templateParts` / `customTemplates` registrations from step 4, where `<theme-slug>` is the `themeSlug` stored in `neptune-config.json`. Reference:
   - `wordpress/.agents/skills/wp-block-themes/SKILL.md` — how to update theme.json.
   - `wordpress/.agents/skills/wp-block-themes/references/theme-json.md` — theme.json structure, feature/block support, and how to register template parts and custom templates.
   - `devNotes` in `neptune-config.json` — any style-relevant context the designer called out.

   If the Block Themes reference files do not exist, tell the user they need to install the Block Themes Studio agent skill before this skill can proceed.

6. Always ensure that `parts/header.html` and `parts/footer.html` are registered as template parts in theme.json, even if they weren't captured by `map-design-templates`.

7. For any human-actionable follow-up surfaced during this skill, open a GitHub issue per the procedure in `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.

8. Set `themeJsonCompleted: true` in `neptune-config.json` so future runs know `theme.json` has been generated.

9. Tell the user `theme.json` has been written and the next step is `/build-template <name>` (per unique `wordpressFile` in `templateMappings`) — or `/build-all-templates` to batch all unbuilt wrappers in one run.
