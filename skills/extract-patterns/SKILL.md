---
name: extract-patterns
description: Walks the linked Figma file's published components and generates a WordPress block-pattern for each one into the theme's `patterns/` directory, then records the slug-to-Figma-node mapping in neptune-config.json so subsequent /build-* runs reference patterns by slug instead of re-emitting their block markup. Used after `theme-json` and before `/build-template`. Triggers on phrases like "extract patterns from Figma", "generate block patterns", "build the pattern library", or "register reusable components".
model: opus
---

Why this skill exists: when a designer uses the same component (e.g. a feature card, a CTA section, a media-text row) across many Figma frames, every `/build-template` and `/build-content` run that meets that component would otherwise re-generate its block markup from scratch — and would drift across pages, because the LLM has no shared anchor. This skill lifts those repeated components into named WordPress block patterns once, so downstream commands reference them by slug (`<!-- wp:pattern {"slug":"<themeSlug>/<pattern-slug>"} /-->`) and the markup stays consistent across the whole site.

Prerequisites checked:

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh themeJsonCompleted templateMappings`. If it fails, surface its message to the user and stop.
2. Load the `figma:figma-use` skill before any Figma MCP call that requires JS execution in the file context.

Steps:

1. Read `figmaFileId` and `themeSlug` from `neptune-config.json`. Locate the theme directory at `wordpress/wp-content/themes/<themeSlug>`.

2. Use the Figma MCP to enumerate the **published components** in the file (the entries from the file's component library — not every primitive group). `mcp__figma__get_metadata` on the file returns the component list. Filter to components actually used inside the `🗒️ Templates` layer of the `🛠️  Dev Handoff` page — components that are defined but never instantiated are not worth registering. If the file has a `🧩 Components` (or similarly named) page, prefer the components defined there as the canonical source.

3. For each in-scope component, ask the user once at the start of the run whether to (a) extract every component, (b) extract only components used in two or more `templateMappings` frames, or (c) walk through the list and confirm one at a time. Default to (b) — single-use components don't need pattern lift since they only ever appear once. Record the user's choice for the rest of the run.

4. For each component selected for extraction:
   a. Pull the component's design with `mcp__figma__get_design_context` using its node ID. Capture the screenshot, the design tokens, and any Code Connect snippets the response surfaces.
   b. Generate the pattern's block markup. Use only block markup; never fall back to plain HTML or `wp:html`. If a goal would only be achievable with `wp:html`, leave a placeholder paragraph block and open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` describing what the human needs to wire up.
   c. Validate the markup by calling `mcp__wordpress-studio__validate_blocks` with the generated content. If validation reports errors, fix them and re-validate before writing the file. Do not write invalid markup to disk.
   d. Derive a stable, lowercase, hyphen-separated `pattern-slug` from the component name (e.g. `Feature Card` → `feature-card`). The fully qualified pattern name is `<themeSlug>/<pattern-slug>`.
   e. Write the validated markup to `wordpress/wp-content/themes/<themeSlug>/patterns/<pattern-slug>.php` with the standard WP pattern header block:
      ```
      <?php
      /**
       * Title: <human-readable component title>
       * Slug: <themeSlug>/<pattern-slug>
       * Categories: <one or more, e.g. "featured" or a custom category>
       * Description: <one-line description, taken from the Figma component description if present>
       */
      ?>
      <!-- the validated block markup -->
      ```
      WordPress autoloads any PHP file under `patterns/` that begins with this header; no further registration is needed.

5. Record the registry under a `patterns` object in `neptune-config.json`. Each key is the pattern slug; each value carries enough context for `/build-*` commands to know when to reference the pattern instead of re-emitting markup. Example:
   ```json
   {
     "patterns": {
       "feature-card": {
         "title": "Feature Card",
         "fullSlug": "<themeSlug>/feature-card",
         "figmaComponentId": "<node-id>",
         "figmaComponentKey": "<component-key-if-published>",
         "file": "patterns/feature-card.php"
       }
     }
   }
   ```

6. Set `patternsCompleted: true` in `neptune-config.json`. If the user opted to skip this skill entirely (e.g. "I don't want patterns this project"), still set the flag — it signals the workflow has moved past this phase.

7. Open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` for any component that could not be cleanly extracted (validation kept failing, dependent variables missing from `theme.json`, etc.) so the human knows to revisit it.

8. Tell the user how many patterns were extracted, list the slugs, and note that `/build-template` and `/build-content` will reference these patterns by slug in subsequent runs. The next step is `/build-template <name>` (or `/build-all-templates`).
