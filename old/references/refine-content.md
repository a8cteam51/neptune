# Refine content reference

Refine the body content of one entry in `templateMappings` — the per-page content previously filled by `/build-content`. This procedure is invoked once **per `templateMappings` entry**: sibling entries that share a `wordpressFile` each have their own WP_Post body, so each one needs its own refinement run.

The wrapper template (header/footer + `<!-- wp:post-content /-->`) is refined separately by `/refine-template`. This procedure only refines what lives inside `<!-- wp:post-content /-->` — the `post_content` of the WP_Post the wrapper renders. Wrapper-level discrepancies surfaced during diffing should be flagged for the user and deferred to `/refine-template`, not fixed here.

Resolve the page URL in this priority order: (a) the URL passed in `$ARGUMENTS`; (b) the `pageUrl` field on this entry in `templateMappings`; (c) ask the user. If `$ARGUMENTS` is empty, ask the user which `templateMappings` entry to refine (list the entry keys from `neptune-config.json`), and ask for the URL only if the matching entry has no `pageUrl`.

Figma is the source of truth for the design. Adjust the WordPress post body to match Figma — never the other way around.

Preflight (run before any other step):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted templateMappings themeSlug figmaFileId` — fail fast if prior phases are incomplete.

Context to load before starting:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- The Figma MCP — Figma is the source of truth. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context. Pull numeric token values via a `use_figma` JS call.
- `${CLAUDE_PLUGIN_ROOT}/references/reading-design-context.md` — translation contract for `mcp__figma__get_design_context` output. Apply it whenever you compare the Figma side of the diff against rendered markup; the same blueprint-not-literal rules govern what counts as a real discrepancy vs. a React/Tailwind artefact.
- The `wordpress-studio` MCP — `take_screenshot` for the rendered shot, `validate_blocks` for any block-markup edits, `wp_cli` for runtime introspection.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.
- `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md` — every styling, validation, building, and accessibility/performance/SEO guardrail there applies to refinement edits the same way it applies to the initial build.
- `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` — allow-list of blocks; any markup change must stay inside it.
- `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` — `theme.json` keys; any token-level change must respect this contract.
- For any human-actionable follow-up surfaced during this command, open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.

## Diff strategy

Same measure-first / vision-fallback strategy as `${CLAUDE_PLUGIN_ROOT}/references/refine-template.md` (see "Diff strategy"). Numeric measurements override visual impressions on disagreement. The discrepancy table includes a `source` column (`measured` / `visual`) and a `scope` column (`body` / `wrapper`) — only `body` rows are acted on here; `wrapper` rows are deferred to `/refine-template`.

## Steps

1. Read `templateMappings` from `neptune-config.json`. Resolve which entry this run targets — by `template-name` from `$ARGUMENTS` (matching an entry key), or by asking the user. The targeted entry is `{ "wordpressFile": "<path>", "figmaNodes": { "desktop": "<node-id>", "mobile": "<node-id>" }, "pageUrl": "<url>" }`. If `figmaNodes` is missing or empty, stop and ask the user to re-run `/map-design-templates` so node IDs are captured.

2. Resolve the page URL for this entry in this priority order: (a) the `page-url` argument from `$ARGUMENTS`; (b) the `pageUrl` field on the chosen entry in `templateMappings`; (c) ask the user. If the URL came from the stored `pageUrl`, sanity-check with `curl -sf -o /dev/null -w '%{http_code}' '<url>'`; on 4xx/5xx, treat it as stale and re-resolve via WP CLI (or ask the user) rather than trust it.

3. Resolve the WP post ID from the URL using WP CLI. Use `url_to_postid` because it handles the front page, the posts page, custom permalinks, and trailing-slash variations correctly:
   ```bash
   studio wp eval "echo url_to_postid( '<page-url>' );"
   ```
   If the result is `0` or empty, fall back to extracting the slug from the URL path and looking it up:
   ```bash
   studio wp post list --post_type=any --name=<slug> --field=ID --format=ids
   ```
   If both lookups fail, stop and ask the user to confirm the page exists and is published. Do not create the post automatically.

4. Take a screenshot of the rendered page at the resolved page URL via `mcp__wordpress-studio__take_screenshot`. Record the breakpoint (desktop or mobile width) so step 5 can match it.

5. Pull the Figma design directly via the Figma MCP — call `mcp__figma__get_design_context` (and `mcp__figma__get_screenshot` if you need a separate image) using `figmaFileId` from `neptune-config.json` and the relevant node ID under `figmaNodes`. Match the breakpoint of the rendered screenshot from step 4: use the `desktop` node for a desktop-width screenshot, the `mobile` node for a mobile-width screenshot. If both are available and relevant, refine against each in turn. The captured node IDs cover the **whole** template design (wrapper + body); for refinement here, extract only the body region — the content that sits between the header and footer of the design. Wrapper-level differences are out of scope. Also pull the file's variable definitions once via a `use_figma` JS call — its output feeds the numeric comparison.

6. Run the measure-first / vision-fallback diff per `${CLAUDE_PLUGIN_ROOT}/references/refine-template.md`'s "Diff strategy" section. Produce a single discrepancy table with columns `region` | `property` | `figma` | `rendered` | `source` | `scope` | `severity`. Share it with the user before making changes. Only proceed to step 7 with rows whose `scope` is `body`; flag `wrapper` rows for `/refine-template` and surface them again in the final summary.

7. Pull the current `post_content` for the post into a temp file so you can edit it cleanly without re-generating from scratch:
   ```bash
   studio wp post get <post-id> --field=post_content > /tmp/neptune-content-<post-id>.html
   ```
   Apply refinements to resolve each in-scope discrepancy — edits to block markup in the temp file, and where appropriate to `theme.json` or block stylesheets in the theme tree. Validate any block-markup change with `mcp__wordpress-studio__validate_blocks` before writing it back. Do not fall back to plain HTML at any point. If you're about to use a `wp:html` block to achieve a goal, stop — leave the existing markup as-is for that region and open a GitHub issue describing what the human needs to wire up. For internal links inside the body, wire each `href` to a `pageUrl` from `templateMappings` whenever the link label matches a mapped entry; for labels that don't match, leave a placeholder `#` href and open a GitHub issue listing the unwired labels.

8. Write the edited content back via WP CLI:
   ```bash
   studio wp post update <post-id> --post_content="$(cat /tmp/neptune-content-<post-id>.html)"
   ```
   After the update, verify with `studio wp post get <post-id> --field=post_content | head -n 5` that the new content is present (a quick check that the update wrote and didn't silently no-op due to a quoting issue). Delete the temp file once the update is verified.

9. Re-take the screenshot from step 4 at the same breakpoint and confirm the in-scope discrepancies have been resolved. If any remain, iterate on steps 6–8 until either they're resolved or you've reached a point where remaining differences need human input — in which case open a GitHub issue describing what's blocked. If you opened any GitHub issues during this run, list them at the end with their URLs.

10. If wrapper-level discrepancies were flagged in step 6, remind the user to run `/refine-template <template-name> <page-url>` to address them — those edits live in the theme file, not in `post_content`, and are out of scope here.

## Handling structural design changes

`/refine-content` is tuned for spacing/typography drift. If the Figma design has gained or lost an entire section since `/build-content` ran (vs. just changing styles within existing sections), the discrepancy table will show many large-severity rows. In that case, stop after producing the table and ask the user whether they would prefer to re-run `/build-content` (which regenerates the post body from the current Figma frame) instead of fighting the diff one section at a time. Re-running build is often the cheaper recovery for structural changes.
