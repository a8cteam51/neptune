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
2. Read the corresponding entry from `templateMappings` in `neptune-config.json`. Each value is an object of the form `{ "wordpressFile": "<path>", "screenshot": "<path or null>" }`. Use the `screenshot` field to locate the Figma export under `screenshots/`. If `screenshot` is null, stop and ask the user to export the matching Figma template into `screenshots/` and re-run `map-design-templates` before continuing.
3. Compare the two screenshots. Produce a table of discrepancies (layout, spacing, typography, color, component differences) and share it with the user before making changes.
4. Apply refinements to resolve each discrepancy — edits to block markup, `theme.json`, or block stylesheets as appropriate. Follow the same styling guardrails as `/build-template`: prefer `theme.json`, block stylesheets only for what `theme.json` cannot express, never inline CSS in `theme.json` or `style.css`.
5. If you have any follow-ups for the user, which are direct human actionable tasks. Open an issue for each on GitHub in the project repo, and link to the relevant section of the Figma file or the specific dev note that inspired the task. You'll use `gh issue create` for this, and you can find the repository URL and theme slug in `neptune-config.json` to construct the command. Note in the body text that the issue was create by Neptune.
