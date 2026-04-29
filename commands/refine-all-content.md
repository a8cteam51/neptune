---
description: Visual-diff the body of every filled `templateMappings` entry against its Figma design by spawning one subagent per entry.
model: sonnet
argument-hint: [site-url] [--skip=name1,name2]
allowed-tools: Agent, Read, Edit, Write, Glob, Grep, Bash(studio wp:*), Bash(curl:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Bash(gh issue create:*), Bash(gh repo view:*)
---

Orchestrate body-content refinement for every filled entry in `templateMappings` against its Figma design. This command **runs as an orchestrator** — the actual per-entry refinement happens inside subagents spawned via the `Agent` tool, one per eligible entry. Read `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` for the orchestrator/subagent contract.

`$ARGUMENTS` may contain a base site URL (e.g. `https://my-site.test`) used as a fallback when an entry has no `pageUrl`, and an optional `--skip=<comma-separated-names>` flag (see `batch-policy.md` "Argument parsing"). If a site URL is not present in `$ARGUMENTS` **and** at least one eligible entry is missing a `pageUrl`, ask the user for one — refinement requires a rendered screenshot.

Figma is the source of truth for the design. Adjust the WordPress post body to match Figma — never the other way around.

Preflight (run before planning):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted templateMappings themeSlug figmaFileId` — fail fast if prior phases are incomplete.

Context to load:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- `${CLAUDE_PLUGIN_ROOT}/commands/refine-content.md` — the per-entry refinement procedure each subagent will follow.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — referenced by `refine-content.md` for shared styling guardrails.
- `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` — orchestrator/subagent contract, `--skip` parsing, return-shape.

## Steps

1. **Plan.** Read `templateMappings`. Stop and report if it is empty — the user needs to run `/map-design-templates` first. Note: unlike `/refine-all-templates`, this command does not group by `wordpressFile` — every entry has its own WP_Post body and is refined individually.

2. **Determine eligibility.** For each entry, treat it as eligible if all of the following hold:
   - `figmaNodes` is present and non-empty.
   - A `pageUrl` is present on the entry, or can be derived from the base site URL in `$ARGUMENTS` using the entry key + WordPress template hierarchy.
   - The target WP post resolves via the URL (using the same lookup chain as `/refine-content` step 3: `studio wp eval "echo url_to_postid( '<page-url>' );"`, falling back to `studio wp post list --post_type=any --name=<slug-from-url> --field=ID --format=ids` if `url_to_postid` returns `0`).
   - The post body is already filled — refinement is meaningless on an empty body. Use the same cheap signal as `/build-all-content`: `studio wp post get <id> --field=post_content | grep -q '<!-- wp:'`.

   Skip with reason for any entry that fails one of these checks: `skipped:missing-figma-nodes` (re-run `/map-design-templates`), `skipped:no-resolvable-url`, `skipped:post-not-found`, `skipped:post-empty` (run `/build-content` first).

3. **Apply `--skip`.** Parse per `batch-policy.md` "Argument parsing". Per-entry batches: matched entries are removed directly.

4. **Sanity-check stored URLs.** For any entry whose URL came from the stored `pageUrl`, run `curl -sf -o /dev/null -w '%{http_code}' '<url>'` before adding it to the eligible set; on 4xx/5xx, treat the stored value as stale and either re-resolve via WP CLI or ask the user.

5. **Confirm with user.** Show the plan: the list of entries you intend to refine (entry key → `wordpressFile` → `pageUrl` → resolved post ID), plus any skipped entries grouped by reason. Wait for the user to confirm before continuing.

6. **Per-item subagent loop.** For each eligible entry, in `templateMappings` key order, spawn a subagent via the `Agent` tool with a self-contained prompt that:
   - States the project root, `themeSlug`, `figmaFileId`.
   - States the entry key, `wordpressFile`, `figmaNodes`, `pageUrl`, and the resolved post ID.
   - Includes only the `devNotes` whose `context` plausibly applies to this entry's body — filter at the orchestrator before spawning.
   - Instructs: "Read `${CLAUDE_PLUGIN_ROOT}/commands/refine-content.md` and follow it end-to-end for the entry above, with one divergence: do **not** pause to share the discrepancy table with the user — produce the table inline as part of your work and proceed to apply refinements (the user gated this batch). Refine against both `desktop` and `mobile` nodes where both are present. Tag each discrepancy row as `body` (in scope, fixed via `studio wp post update`) or `wrapper` (out of scope — deferred to `/refine-template`); only act on `body` rows, but include both in the report. Apply the measure-first / vision-fallback diff strategy strictly. Validate any block-markup change via `mcp__wordpress-studio__validate_blocks` before writing it."
   - Demands the structured return shape from `batch-policy.md` "Subagent return contract", including a populated `DISCREPANCIES` block with `scope` per row.
   - Tool budget: `Read, Edit, Write, Glob, Grep, Bash(studio wp:*), Bash(rm:*), Bash(cat:*), Bash(curl:*), Bash(gh issue create:*), Bash(gh repo view:*), Skill, mcp__figma__*, mcp__wordpress-studio__*`.
   - Use the `subagent_type: "general-purpose"` agent. Pass `model: "sonnet"`.

7. **Between items.** Append the subagent's structured report (including its discrepancy table, with `scope`-tagged rows) to the running summary. Move to the next entry. No `/compact` pause.

8. **Final summary.** After the loop, render the standard summary per `batch-policy.md` "Final summary". Collate any rows tagged `wrapper` across all entries into a single deferred-to-`/refine-template` section so the user can see the wrapper-level work that still needs doing, ideally grouped by `wordpressFile`. Remind the user to re-run `/refine-all-content` (or `/refine-content <name>` for a single entry) after any subsequent design changes in Figma.
