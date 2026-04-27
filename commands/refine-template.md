---
description: Visual-diff a rendered template/part against its Figma design and apply refinements so the rendered output matches Figma.
argument-hint: [template-or-part-name] [site-url]
---

Refine the template or template part named in `$ARGUMENTS`, using the site URL the user also supplies in `$ARGUMENTS` for visual testing. Resolve the site URL in this priority order: (a) the URL passed in `$ARGUMENTS`; (b) the `pageUrl` field on this template's entry in `templateMappings` from `neptune-config.json`, if present; (c) ask the user. If `$ARGUMENTS` is empty, ask the user for:
- Which template or template part to refine (from `templateMappings` in `neptune-config.json`).
- The URL where the local or staging site can be reached, only if the matching `templateMappings` entry has no `pageUrl`.

Figma is the source of truth for the design. Adjust the WordPress template to match Figma — never the other way around.

Context to load before starting:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- The `wp-blockmarkup` MCP — for block markup changes.
- The Figma MCP — Figma is the source of truth. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.
- Read the styling and building guardrails outlined in `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md`

Steps:

1. Take a screenshot of the rendered template at the user-provided site URL (use the `wordpress-studio` MCP's `take_screenshot` tool, or any browser automation already available to you).
2. Read the corresponding entry from `templateMappings` in `neptune-config.json`. Each value is an object of the form `{ "wordpressFile": "<path>", "figmaNodes": { "desktop": "<node-id>", "mobile": "<node-id>" }, "pageUrl": "<url>" }`. If `figmaNodes` is missing or empty for this mapping, stop and ask the user to re-run `map-design-templates` so the Figma node IDs are captured before continuing. If multiple `templateMappings` entries share this entry's `wordpressFile`, this run refines the **wrapper** for that file using this entry's `figmaNodes` and `pageUrl`. The other sibling entries' page-specific designs are concerns for `/build-content` and its own refinement, not this one.
3. Pull the Figma design directly via the Figma MCP — call `mcp__figma__get_design_context` (and `mcp__figma__get_screenshot` if you need a separate image) using `figmaFileId` from `neptune-config.json` and the relevant node ID under `figmaNodes`. Match the breakpoint of the rendered screenshot you took in step 1: use the `desktop` node for a desktop-width screenshot, the `mobile` node for a mobile-width screenshot. If both are available and relevant, refine against each in turn.
4. Compare the rendered screenshot against the Figma design context. Produce a table of discrepancies (layout, spacing, typography, color, component differences) and share it with the user before making changes.
5. Apply refinements to resolve each discrepancy — edits to block markup, `theme.json`, or block stylesheets as appropriate.
