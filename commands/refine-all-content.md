---
description: Visual-diff the body of every filled `templateMappings` entry against its Figma design, running each through `/refine-content`.
argument-hint: [site-url] [--skip=name1,name2]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh issue create:*), Bash(gh repo view:*), Bash(studio wp:*), Bash(rm:*), Bash(cat:*), Skill, mcp__figma__*, mcp__wp-blockmarkup__*, mcp__wordpress-studio__take_screenshot
---

Refine the body content of every filled entry in `templateMappings` from `neptune-config.json` against its Figma design. `$ARGUMENTS` may contain a base site URL (e.g. `https://my-site.test`) used as a fallback when an entry has no `pageUrl`, and an optional `--skip=<comma-separated-names>` flag to exclude specific mappings from this run (matched against `templateMappings` keys, e.g. `--skip=About,Contact`). If a site URL is not present in `$ARGUMENTS` **and** at least one eligible entry is missing a `pageUrl`, ask the user for one — refinement requires a rendered screenshot, so this command cannot run without a URL per entry. Treat `--skip` as optional — if it's absent, do not prompt for it.

This command is a batch wrapper around `${CLAUDE_PLUGIN_ROOT}/commands/refine-content.md`. Read that file once before the loop — every guardrail there (body-only scope, wrapper-level differences deferred to `/refine-template`, no `wp:html` fallback, block markup only, GitHub issues for human follow-ups, internal-link wiring from `templateMappings`) applies to each entry refined in this run. Figma is the source of truth for the design. Adjust the WordPress post body to match Figma — never the other way around. Read `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` for the shared execution model (inline-only, pause every 2 items for `/compact`, write to disk and database between items, discrepancy table inline rather than gated).

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- `${CLAUDE_PLUGIN_ROOT}/commands/refine-content.md` — full per-entry refinement procedure.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — styling and building guardrails referenced from the refinement procedure.
- The same MCPs and skills `/refine-content` requires (`wp-blockmarkup`, Figma MCP + `figma:figma-use`, `wp-block-themes` skill, `studio wp` access, and a screenshot tool such as the `wordpress-studio` MCP's `take_screenshot`).

Steps:

1. Read `templateMappings` from `neptune-config.json`. Stop and report if `templateMappings` is empty or missing — the user needs to run `/map-design-templates` first. Note: unlike `/refine-all-templates`, this command does not group by `wordpressFile` — every entry has its own WP_Post body and is refined individually.

2. For each entry, determine eligibility. An entry is **eligible** if all of the following hold:
   - `figmaNodes` is present and non-empty.
   - A `pageUrl` is present on the entry, or can be derived from the base site URL in `$ARGUMENTS` using the entry key + WordPress template hierarchy.
   - The target WP post resolves via the URL (using the same lookup chain as `/refine-content` step 3: `studio wp eval "echo url_to_postid( '<page-url>' );"`, falling back to `studio wp post list --post_type=any --name=<slug-from-url> --field=ID --format=ids` if `url_to_postid` returns `0`).
   - The post body is already filled — refinement is meaningless on an empty body. Use the same cheap signal as `/build-all-content` step 4:
     ```bash
     studio wp post get <id> --field=post_content | grep -q '<!-- wp:' && echo filled || echo empty
     ```
     Treat the entry as filled if the body contains any `<!-- wp:` delimiter.

   Skip with reason for any entry that fails one of these checks: **missing figmaNodes** (note: re-run `/map-design-templates`), **no resolvable URL**, **post not found**, **post empty** (note: run `/build-content <name>` or `/build-all-content` first).

3. If `$ARGUMENTS` contains a `--skip=<names>` flag, parse it into a list (comma-separated, trimmed) and drop any matching entry from the eligible set. If a skip entry does not match any key in `templateMappings`, warn the user that the name was unrecognized but continue.

4. Show the user the plan: the list of entries you intend to refine (entry key → `wordpressFile` → `pageUrl` → resolved post ID), plus any skipped entries grouped by reason (`--skip`, missing `figmaNodes`, no `pageUrl`, post not found, post empty). Wait for the user to confirm before continuing.

5. For each eligible entry, in `templateMappings` key order, perform the per-entry refinement inline by following `${CLAUDE_PLUGIN_ROOT}/commands/refine-content.md` end-to-end, with one divergence: do **not** pause to share the discrepancy table with the user — produce the table as part of the inline output and proceed to apply refinements. The user gated the batch at step 4 above. Refine against both `desktop` and `mobile` nodes where both are present, taking one screenshot per breakpoint at the appropriate viewport width. Tag each discrepancy row as `body` (in scope, fixed here via `studio wp post update`) or `wrapper` (out of scope — deferred to `/refine-template`); only act on `body` rows, but record both for the final summary. Filter `devNotes` per entry before reasoning over them; do not let unrelated notes pollute the refinement. After finishing each entry, write the post update via `studio wp post update <id> --post_content="$(cat <tmpfile>)"` and any `theme.json` / stylesheet edits to disk before starting the next, so subsequent entries read the finished state from disk and the database rather than from conversation history.

6. **Pause after every 2 entries** per `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md`. The pause message should name the two entries just refined and list the remaining entries. The discrepancy tables from completed entries are preserved in the conversation summary; collate them into the final report at step 7.

7. After all entries are processed, output the final summary per `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md`. Collate any rows tagged `wrapper` across all entries into a single deferred-to-`/refine-template` section so the user can see the wrapper-level work that still needs doing, ideally grouped by `wordpressFile`. Remind the user to re-run `/refine-all-content` (or `/refine-content <name>` for a single entry) after any subsequent design changes in Figma.
