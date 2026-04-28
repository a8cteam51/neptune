---
description: Visual-diff the body of every filled `templateMappings` entry against its Figma design, running each through `/refine-content`.
argument-hint: [site-url] [--skip=name1,name2]
---

Refine the body content of every filled entry in `templateMappings` from `neptune-config.json` against its Figma design. `$ARGUMENTS` may contain a base site URL (e.g. `https://my-site.test`) used as a fallback when an entry has no `pageUrl`, and an optional `--skip=<comma-separated-names>` flag to exclude specific mappings from this run (matched against `templateMappings` keys, e.g. `--skip=About,Contact`). If a site URL is not present in `$ARGUMENTS` **and** at least one eligible entry is missing a `pageUrl`, ask the user for one — refinement requires a rendered screenshot, so this command cannot run without a URL per entry. Treat `--skip` as optional — if it's absent, do not prompt for it.

This command is a batch wrapper around `${CLAUDE_PLUGIN_ROOT}/commands/refine-content.md`. Read that file first — every guardrail there (body-only scope, wrapper-level differences deferred to `/refine-template`, no `wp:html` fallback, block markup only, GitHub issues for human follow-ups, internal-link wiring from `templateMappings`) applies to each entry refined in this run. Figma is the source of truth for the design. Adjust the WordPress post body to match Figma — never the other way around.

Each per-entry refinement is delegated to a **subagent** (via the Agent tool). Subagents run **sequentially** — one at a time, never in parallel. Reasons:
- **Context budget.** Refinement is heavier than building: each pass pulls a Figma design context, takes (and reasons about) a rendered screenshot, and produces a discrepancy analysis. Doing this for every entry in the main agent's context would exhaust it before the batch finishes. Subagents let each entry's working set live and die in a separate context.
- **Shared mutable state.** While body content is per-post (no cross-entry collision in the database), refinements may also touch `theme.json`, `register_block_style` registrations in `functions.php`, and `assets/block-styles/src/*.scss`. Concurrent subagents would race on those files; sequencing avoids it.

One deliberate divergence from per-entry `/refine-content`: step 6 of that command says "share the discrepancy table with the user before making changes." In a batch run the user has already opted into refinement at step 4 below, so each subagent **includes its discrepancy table verbatim in its return report** and proceeds to apply refinements without an extra per-entry gate. The main agent surfaces those tables in the final summary.

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

5. For each eligible entry, in `templateMappings` key order, launch one subagent via the Agent tool to perform the per-entry refinement. **Wait for each subagent to return before launching the next** — never run two concurrently, never use `run_in_background` for these. Use `subagent_type: "general-purpose"` and do **not** pass `isolation: "worktree"` — the subagent must write to the live WordPress database via `studio wp` and to the live theme tree (for any `theme.json` or block-stylesheet edits), so subsequent subagents (and the user) see the refinements applied.

   Each subagent's prompt must be self-contained, since it has no view of this conversation. Brief it with:
   - The entry's key, the `wordpressFile` path, the `figmaNodes` (desktop / mobile node IDs), and the resolved WP post ID.
   - The `figmaFileId`, `themeSlug`, and `repositoryUrl` from `neptune-config.json` (the last is needed for `gh issue create`).
   - The resolved `page-url` for this entry.
   - Only the `devNotes` entries that apply to this entry — filter before sending; do not dump the whole array.
   - The list of sibling `templateMappings` entries that share this entry's `wordpressFile`, with a note that wrapper-level differences are `/refine-template`'s concern and out of scope for this refinement.
   - An explicit instruction to read `${CLAUDE_PLUGIN_ROOT}/commands/refine-content.md` and follow its procedure, with one divergence: do **not** pause to share the discrepancy table with the user — instead, include the table verbatim in the return report and proceed to apply refinements. The user gated the batch at step 4 above.
   - An instruction to refine against both `desktop` and `mobile` nodes where both are present, taking one screenshot per breakpoint at the appropriate viewport width.
   - A reminder that wrapper-level discrepancies surfaced during diffing must be flagged in the return report (not fixed) and deferred to `/refine-template <name> <page-url>` — this command only edits `post_content`, not the theme file.
   - A structured report format to return: entry key used, breakpoints covered, the **full** discrepancy table (do not truncate — these are the substantive deliverable the user wants from the run, and each row should be tagged `body` or `wrapper` so the main agent can collate wrapper findings for the summary), files edited (the post via `studio wp post update`, plus any `theme.json` / stylesheet changes), GitHub issues opened (with URLs), unresolved follow-ups, and any deviations from the refine-content procedure. Aim for tight prose around the table; the table itself can be as long as it needs to be.

   Treat each subagent as an independent invocation: do not carry assumptions from one entry's subagent into another beyond what's already shared via `theme.json` and registered block styles (which the next subagent will read fresh from disk).

6. After all subagents have returned, output a summary aggregated from each subagent's report: refined entries (entry key → post ID → `pageUrl`, with breakpoints covered), the **full discrepancy table from each subagent** (concatenated under per-entry headings — the user expects to see what changed and why), skipped (with reason, including `--skip` exclusions), and any GitHub issues opened during the run. Collate any rows tagged `wrapper` across all subagent reports into a single deferred-to-`/refine-template` section so the user can see the wrapper-level work that still needs doing, ideally grouped by `wordpressFile`. Remind the user to re-run `/refine-all-content` (or `/refine-content <name>` for a single entry) after any subsequent design changes in Figma.
