---
name: theme-json
description: Generates theme.json from the Figma file's `🎨 Style Guide` layer and variable tables (palette, typography, spacing) and registers the template parts and custom templates captured by `map-design-templates`. Used after map-design-templates — writes a populated theme.json into the project theme directory. 
---

0. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted templateMappings themeSlug figmaFileId figmaVariables figmaStyleGuideNodeId`. If it fails, surface the message and stop.

1. Confirm the user has installed the WordPress Block Themes agent skill inside Studio (see https://developer.wordpress.com/docs/developer-tools/studio/agent-skills-wordpress-studio/).

2. Read `figmaVariables` from `neptune-config.json` — this is the raw output of `mcp__figma__get_variable_defs`, captured during `pull-figma`. It contains every named variable in the file (palette colors, font definitions, spacing scale, etc.) with resolved values per mode. Use it as the **primary** source for the style dataset that `theme.json` needs.

3. Cross-reference variables against the visual `🎨 Style Guide` rendering. Read `figmaStyleGuideNodeId` from `neptune-config.json` and call `mcp__figma__get_design_context` on it once. The response shows which variables the style guide actually demonstrates (vs. defining-but-unused variables) and how typography variants combine font-family + size + weight + line-height.

4. Read `templateMappings` from `neptune-config.json` and derive the registrations theme.json needs:
   - **Template parts** — every entry whose `wordpressFile` lives under `parts/` (e.g. `parts/header.html`, `parts/footer.html`). Register each under `templateParts` with an `area` of `header`, `footer`, or `uncategorized` based on the file name; ask the user if the area is ambiguous.
   - **Custom templates** — every entry whose `wordpressFile` lives under `templates/` and is **not** one of the WordPress hierarchy defaults (`index.html`, `home.html`, `front-page.html`, `single.html`, `singular.html`, `page.html`, `archive.html`, `category.html`, `tag.html`, `author.html`, `date.html`, `taxonomy.html`, `search.html`, `404.html`, `attachment.html`). Register each under `customTemplates` with a human-readable `title` derived from the Figma title-card name and a sensible `postTypes` value (default `["page"]`; ask if unsure).
   After registering custom templates, be sure to update the pages in WordPress that use them to select the new templates in the page attributes — otherwise they will continue rendering with the default `page.html` template and not pull in the new designs. 
   When several `templateMappings` entries point at the same `wordpressFile`, register it once. If `templateMappings` is missing or empty, stop and tell the user to run `map-design-templates` first.

5. Update `wordpress/wp-content/themes/<theme-slug>/theme.json` with the style dataset from step 3 and the `templateParts` / `customTemplates` registrations from step 4, where `<theme-slug>` is the `themeSlug` stored in `neptune-config.json`. Reference:
   - `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` — Neptune's authoritative subset of `theme.json` keys, slug derivation rules, merge semantics, and validation invariants. Treat this as the contract `theme.json` must match.
   - `wordpress/.agents/skills/wp-block-themes/SKILL.md` — how to update theme.json.
   - `wordpress/.agents/skills/wp-block-themes/references/theme-json.md` — theme.json structure, feature/block support, and how to register template parts and custom templates.
   - `devNotes` in `neptune-config.json` — any style-relevant context the designer called out.

   If the Block Themes reference files do not exist, tell the user they need to install the Block Themes Studio agent skill before this skill can proceed.

6. Always ensure that `parts/header.html` and `parts/footer.html` are registered as template parts in theme.json, even if they weren't captured by `map-design-templates`.

7. Invoke the `theme-validator` subagent (Task tool, `subagent_type: theme-validator`) to verify the freshly-written `theme.json` against the invariants documented in `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` — slug uniqueness, version, `$schema`, `templateParts` / `customTemplates` resolving to existing files, preset references in `styles.*`. Fix any `ERROR` rows it returns before continuing; surface `WARNING` rows in the run summary. The validator is read-only — it never edits files.

8. For any human-actionable follow-up surfaced during this skill, open a GitHub issue per the procedure in `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.

9. Set `themeJsonCompleted: true` in `neptune-config.json` so future runs know `theme.json` has been generated.

10. The setup phase is now complete. Tell the user how many template parts and custom templates were registered, and that the next step is `/build-template <name>` per unique `wordpressFile` in `templateMappings` — run this slash command manually for each template or part to be built. Prompt the user to discard this session and start fresh to avoid context window overload, since the next phase (`/build-template`) requires a lot of file-specific context that would be too heavy to load all at once.
