---
description: Fill the body content of a single WP_Post / WP_Page from its Figma design and write it back via WP CLI.
argument-hint: [template-name] [page-url]
---

Build the body content for one entry in `templateMappings` and write it onto the corresponding WordPress post or page via `studio wp`. This command is invoked once **per `templateMappings` entry** — sibling entries that share a `wordpressFile` (e.g. multiple page designs all using `page.html`) each have their own body content to fill, so each one needs its own `/build-content` run.

The wrapper template (header/footer + `<!-- wp:post-content /-->`) is built separately by `/build-template`. This command only fills what goes inside `<!-- wp:post-content /-->` — the body of the WP_Post the wrapper renders.

If `$ARGUMENTS` is empty, ask the user which `templateMappings` entry to fill (list the entry keys from `neptune-config.json`). If a `page-url` is supplied in `$ARGUMENTS`, prefer it over the entry's `pageUrl`; otherwise resolve via the entry's `pageUrl`, falling back to asking the user.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- The `wp-blockmarkup` MCP — use it to generate WordPress block markup.
- The Figma MCP — Figma is the source of truth for the content design. Use `mcp__figma__get_design_context` against the relevant node ID under `templateMappings[…].figmaNodes` to pull the actual content design. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.
- Read the styling and building guardrails outlined in `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — every guardrail there (no `wp:html` fallback, block markup only, `register_block_style` workflow, GitHub issues for human-actionable follow-ups, internal links wired from `templateMappings.<entry>.pageUrl` when labels match) applies here too.

Steps:

1. Read `templateMappings` from `neptune-config.json`. Resolve which entry this run targets — by `template-name` from `$ARGUMENTS` (matching an entry key), or by asking the user. The targeted entry is `{ "wordpressFile": "<path>", "figmaNodes": { "desktop": "<node-id>", "mobile": "<node-id>" }, "pageUrl": "<url>" }`. If `figmaNodes` is missing or empty, stop and ask the user to re-run `/map-design-templates` so node IDs are captured.

2. Resolve the page URL for this entry in this priority order: (a) the `page-url` argument from `$ARGUMENTS`; (b) the `pageUrl` field on the chosen entry in `templateMappings`; (c) ask the user. The URL must point at a real, published post or page on the site that `studio` is running — this is how we'll find the post ID.

3. Resolve the WP post ID from the URL using WP CLI. Use `url_to_postid` because it handles the front page, the posts page, custom permalinks, and trailing-slash variations correctly:
   ```bash
   studio wp eval "echo url_to_postid( '<page-url>' );"
   ```
   If the result is `0` or empty, the URL did not resolve to a known post — fall back to extracting the slug from the URL path and looking it up:
   ```bash
   studio wp post list --post_type=any --name=<slug> --field=ID --format=ids
   ```
   If both lookups fail, stop and ask the user to confirm the page exists and is published. Do not create the post automatically — the page is expected to have been created during `setup-project` (Home / Blog) or by the user; auto-creating risks duplicates.

4. Pull the Figma design directly via the Figma MCP for every node ID under `figmaNodes` for this entry. Use `mcp__figma__get_design_context` with `figmaFileId` from `neptune-config.json` and the captured node IDs as the primary source — it returns code, a screenshot, and design tokens in one response. Pull both `desktop` and `mobile` where present. The node IDs captured by `/map-design-templates` cover the **whole** template design (wrapper + body); for `/build-content` you want only the body region — extract the content that sits between the header and footer of the design. If the entry's body is visually identical to the wrapper-source entry's body (i.e. there is no per-page difference), call that out and ask the user whether to skip — there may be nothing for this command to do.

5. Check `devNotes` in `neptune-config.json` for any context that applies to this page's body content.

6. Generate the body content as WordPress block markup only, via the `wp-blockmarkup` MCP. Do not fall back to plain HTML at any point. If you're about to use a `wp:html` block to achieve a goal, stop — add a placeholder paragraph block instead and open a GitHub issue describing what the human needs to wire up. For internal links inside the body (e.g. CTAs pointing at other pages on the site), wire each `href` to a `pageUrl` from `templateMappings` whenever the link label matches a mapped entry; for labels that don't match any mapped entry, leave a placeholder `#` href and open a GitHub issue listing the unwired labels so the user can supply URLs.

7. Write the generated block markup to a temp file (e.g. `/tmp/neptune-content-<post-id>.html`). Multi-line content does not pass cleanly as a shell argument — using a temp file avoids quoting and escaping bugs.

8. Update the post via WP CLI:
   ```bash
   studio wp post update <post-id> --post_content="$(cat /tmp/neptune-content-<post-id>.html)"
   ```
   After the update, verify with `studio wp post get <post-id> --field=post_content | head -n 5` that the new content is present (a quick check that the update wrote and didn't silently no-op due to a quoting issue). Delete the temp file once the update is verified.

9. If a `page-url` was resolved in step 2 and the site is reachable, suggest running `/refine-template <template-name> <page-url>` next so the rendered output can be visual-diffed against Figma — body content benefits from the same refinement pass that wrappers get. Do not auto-invoke `/refine-template`; the user runs it manually.

10. If sibling entries in `templateMappings` share this entry's `wordpressFile` and still have unfilled body content (i.e. their target post's `post_content` is empty or matches the WP default), list them at the end with their `pageUrl` values and remind the user to run `/build-content <name>` once per remaining sibling. Determining "unfilled" can be a soft check (e.g. `studio wp post get <id> --field=post_content | wc -c` returning a small number) — if you're unsure, list all siblings and let the user decide.
