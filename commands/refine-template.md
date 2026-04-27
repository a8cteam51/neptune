---
description: Visual-diff a rendered template/part against its Figma design and apply refinements so the rendered output matches Figma.
argument-hint: [template-or-part-name] [site-url]
---

Refine the template or template part named in `$ARGUMENTS`, using the site URL the user also supplies in `$ARGUMENTS` for visual testing. If `$ARGUMENTS` is empty or missing either value, ask the user for:
- Which template or template part to refine (from `templateMappings` in `neptune-config.json`).
- The URL where the local or staging site can be reached.

Figma is the source of truth for the design. Adjust the WordPress template to match Figma — never the other way around.

Context to load before starting:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`.
- The `wp-blockmarkup` MCP — for block markup changes.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.

Steps:

1. Take a screenshot of the rendered template at the user-provided site URL.
2. Fetch a screenshot of the corresponding Figma design template. This was captured earlier and will exist in a directory named `screenshots` in the project root. Each design is titled by it's mapping in `templateMappings`.
3. Compare the two screenshots. Produce a table of discrepancies (layout, spacing, typography, color, component differences) and share it with the user before making changes.
4. Apply refinements to resolve each discrepancy — edits to block markup, `theme.json`, or block stylesheets as appropriate. Follow the same styling guardrails as `/build-template`: prefer `theme.json`, block stylesheets only for what `theme.json` cannot express, never inline CSS in `theme.json` or `style.css`.
