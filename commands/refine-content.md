---
description: Visual-diff a single rendered WP_Post / WP_Page body against its Figma body design and apply refinements so the rendered content matches Figma.
model: opus
argument-hint: [template-name] [page-url]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh issue create:*), Bash(gh repo view:*), Bash(studio wp:*), Bash(rm:*), Bash(cat:*), Skill, mcp__figma__*, mcp__wp-blockmarkup__*, mcp__wordpress-studio__take_screenshot
---

Refine the body content of one entry in `templateMappings` — the per-page content previously filled by `/build-content`. This command is invoked once **per `templateMappings` entry**: sibling entries that share a `wordpressFile` each have their own WP_Post body, so each one needs its own `/refine-content` run.

The wrapper template (header/footer + `<!-- wp:post-content /-->`) is refined separately by `/refine-template`. This command only refines what lives inside `<!-- wp:post-content /-->` — the `post_content` of the WP_Post the wrapper renders. Wrapper-level discrepancies surfaced during diffing should be flagged for the user and deferred to `/refine-template`, not fixed here.

Resolve the page URL in this priority order: (a) the URL passed in `$ARGUMENTS`; (b) the `pageUrl` field on this entry in `templateMappings`; (c) ask the user. If `$ARGUMENTS` is empty, ask the user which `templateMappings` entry to refine (list the entry keys from `neptune-config.json`), and ask for the URL only if the matching entry has no `pageUrl`.

Figma is the source of truth for the design. Adjust the WordPress post body to match Figma — never the other way around.

Context to load before starting:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- The `wp-blockmarkup` MCP — for block markup changes.
- The Figma MCP — Figma is the source of truth. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.
- Read the styling and building guardrails outlined in `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — every guardrail there (no `wp:html` fallback, block markup only, `register_block_style` workflow, GitHub issues for human-actionable follow-ups, internal links wired from `templateMappings.<entry>.pageUrl` when labels match) applies here too. For any human-actionable follow-up surfaced during this command, open a GitHub issue per the procedure in `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.

Steps:

1. Read `templateMappings` from `neptune-config.json`. Resolve which entry this run targets — by `template-name` from `$ARGUMENTS` (matching an entry key), or by asking the user. The targeted entry is `{ "wordpressFile": "<path>", "figmaNodes": { "desktop": "<node-id>", "mobile": "<node-id>" }, "pageUrl": "<url>" }`. If `figmaNodes` is missing or empty, stop and ask the user to re-run `/map-design-templates` so node IDs are captured.

2. Resolve the page URL for this entry in this priority order: (a) the `page-url` argument from `$ARGUMENTS`; (b) the `pageUrl` field on the chosen entry in `templateMappings`; (c) ask the user. The URL must point at a real, published post or page on the site that `studio` is running.

3. Resolve the WP post ID from the URL using WP CLI. Use `url_to_postid` because it handles the front page, the posts page, custom permalinks, and trailing-slash variations correctly:
   ```bash
   studio wp eval "echo url_to_postid( '<page-url>' );"
   ```
   If the result is `0` or empty, fall back to extracting the slug from the URL path and looking it up:
   ```bash
   studio wp post list --post_type=any --name=<slug> --field=ID --format=ids
   ```
   If both lookups fail, stop and ask the user to confirm the page exists and is published. Do not create the post automatically.

4. Take a screenshot of the rendered page at the resolved page URL (use the `wordpress-studio` MCP's `take_screenshot` tool, or any browser automation already available to you). Record the breakpoint (desktop or mobile width) so step 5 can match it.

5. Pull the Figma design directly via the Figma MCP — call `mcp__figma__get_design_context` (and `mcp__figma__get_screenshot` if you need a separate image) using `figmaFileId` from `neptune-config.json` and the relevant node ID under `figmaNodes`. Match the breakpoint of the rendered screenshot from step 4: use the `desktop` node for a desktop-width screenshot, the `mobile` node for a mobile-width screenshot. If both are available and relevant, refine against each in turn. Do not skip this step. The captured node IDs cover the **whole** template design (wrapper + body); for refinement here, extract only the body region — the content that sits between the header and footer of the design. Wrapper-level differences are out of scope.

6. Compare the rendered screenshot against the Figma body design. Produce a table of discrepancies (layout, spacing, typography, color, content / component differences) and share it with the user before making changes. Categorize each row as **body** (in-scope for this command) or **wrapper** (out-of-scope — to be handled by `/refine-template <template-name> <page-url>`). Only proceed to step 7 with the body rows.

7. Pull the current `post_content` for the post into a temp file so you can edit it cleanly without re-generating from scratch:
   ```bash
   studio wp post get <post-id> --field=post_content > /tmp/neptune-content-<post-id>.html
   ```
   Apply refinements to resolve each in-scope discrepancy — edits to block markup in the temp file, and where appropriate to `theme.json` or block stylesheets in the theme tree. Generate any new block markup via the `wp-blockmarkup` MCP. Do not fall back to plain HTML at any point. If you're about to use a `wp:html` block to achieve a goal, stop — leave the existing markup as-is for that region and open a GitHub issue describing what the human needs to wire up. For internal links inside the body, wire each `href` to a `pageUrl` from `templateMappings` whenever the link label matches a mapped entry; for labels that don't match, leave a placeholder `#` href and open a GitHub issue listing the unwired labels.

8. Write the edited content back via WP CLI:
   ```bash
   studio wp post update <post-id> --post_content="$(cat /tmp/neptune-content-<post-id>.html)"
   ```
   After the update, verify with `studio wp post get <post-id> --field=post_content | head -n 5` that the new content is present (a quick check that the update wrote and didn't silently no-op due to a quoting issue). Delete the temp file once the update is verified.

9. Re-take the screenshot from step 4 at the same breakpoint and confirm the in-scope discrepancies have been resolved. If any remain, iterate on steps 6–8 until either they're resolved or you've reached a point where the remaining differences need human input — in which case open a GitHub issue describing what's blocked. If you opened any GitHub issues during this run, list them at the end with their URLs.

10. If wrapper-level discrepancies were flagged in step 6, remind the user to run `/refine-template <template-name> <page-url>` to address them — those edits live in the theme file, not in `post_content`, and are out of scope here.
