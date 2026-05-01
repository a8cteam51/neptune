---
description: Refine every templateMappings entry whose wrapper is built — sequentially, on the main agent. Each item still pauses at its discrepancy gate for explicit user approval before changes are applied.
argument-hint: [--skip=name1,name2]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh issue create:*), Bash(gh repo view:*), Bash(npm run build:styles:block-styles), Bash(studio wp:*), Bash(curl:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Bash(jq:*), Bash(test:*), Bash(grep:*), Bash(wc:*), Skill, mcp__figma__*, mcp__wordpress-studio__*
---

Refine every `templateMappings` wrapper that has already been built, in one sequential pass on the main agent. This command is the batch analogue of `/refine-template <name>`; the per-item procedure is unchanged, including the discrepancy-table gate that requires user approval before changes are applied.

Read `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` before starting — it spells out the execution model (main agent, sequential, no subagents), the per-item discrepancy gate that refine batches preserve, the `--skip` argument rules, and what the final summary must contain.

Preflight (run before any other step):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted themeJsonCompleted templateMappings themeSlug figmaFileId` — fail fast if prior phases are incomplete.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`, `repositoryUrl`.
- `${CLAUDE_PLUGIN_ROOT}/references/refine-template.md` — the per-item procedure each iteration applies end-to-end.
- `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md` — every styling, validation, building, and accessibility/performance/SEO guardrail there applies to every refinement edit.
- `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` — allow-list of blocks for any block-markup edits applied during refinement.
- `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` — `theme.json` keys; resolve every preset reference against this contract.
- `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` — execution policy.
- `${CLAUDE_PLUGIN_ROOT}/references/reading-design-context.md` — translation contract for `mcp__figma__get_design_context`. Apply per item.
- `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` — every human-actionable follow-up during the run becomes a GitHub issue. Inline lists of TODOs in the final summary are forbidden.
- The Figma MCP — Figma is the source of truth. Confirm the `mcp__figma__*` tools are available before kicking off the loop. Load the `figma:figma-use` skill before any `use_figma` calls (Stage A reads variable definitions through it).
- The `wordpress-studio` MCP — `take_screenshot` for the rendered shot, `validate_blocks` for any block-markup edits, `wp_cli` for runtime introspection.

## Steps

1. **Group entries by `wordpressFile`.** Read `templateMappings`. Multiple entries can share a single `wordpressFile`; `/refine-template` refines the wrapper **once** per file. Group accordingly. For each group, pick the source entry the same way `/refine-template` does: prefer the most generic entry (e.g. an entry titled "Default Page" over "About Page"); if no entry is obviously generic, defer the choice to the user at confirmation time (step 4). The non-source siblings in a group are not refined here — their bodies are concerns for `/refine-content`.

2. **Apply `--skip`.** Parse `$ARGUMENTS` for `--skip=<comma-separated>` per `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` ("Argument parsing"). A `wordpressFile` group is dropped from the eligible set only if **every** entry pointing at it is in the skip list. Tokens that do not match any `templateMappings` key produce one warning line and the run continues.

3. **Determine eligibility per file.** For each remaining group, classify the source entry into exactly one bucket:
   - `eligible` — the wrapper file exists at `wordpress/wp-content/themes/<themeSlug>/<wordpressFile>` (resolve `<themeSlug>` from `neptune-config.json`) **and** contains at least one `<!-- wp:` block delimiter, **and** the source entry has a non-empty `figmaNodes` object, **and** the source entry has a non-empty `pageUrl`.
   - `skipped:not-built` — the wrapper file does not exist on disk, or exists without a `<!-- wp:` block delimiter (refinement requires a built wrapper; the user should run `/build-template <name>` first).
   - `skipped:missing-figmaNodes` — the source entry has no `figmaNodes` (refinement cannot proceed without node IDs to diff against).
   - `skipped:no-pageUrl` — the source entry has no stored `pageUrl` (the batch never prompts for URLs mid-run; the user runs `/refine-template <name> <site-url>` for that one).

   Use `test -s <path>` for existence + non-empty, then `grep -q '<!-- wp:' <path>` for the block-delimiter check. Use `jq` to inspect `figmaNodes` and `pageUrl` on the source entry.

4. **Validate stored `pageUrl`s.** For each eligible item, run `curl -sf -o /dev/null -w '%{http_code}' '<pageUrl>'`. Anything returning 4xx/5xx is treated as a stale URL — drop the item from the eligible set with `skipped:no-pageUrl` and surface it in the plan with the failing status code, so the user can re-resolve via `/map-design-templates` or run `/refine-template <name> <site-url>` themselves.

5. **Confirm the plan with the user.** Print:
   - Eligible groups (one row per `wordpressFile`, listing the source entry, its `figmaNodes` keys, and its `pageUrl`).
   - Rows excluded as `not-built`, `missing-figmaNodes`, `no-pageUrl` (with the offending status code where applicable), or `--skip`.
   - A clear note that **each eligible item will pause for the discrepancy-table review before any changes are applied** — the batch does not bulk-approve.

   If any group's source entry was ambiguous in step 1, ask the user to pick. Wait for explicit confirmation ("yes", "go", or equivalent) before doing any work.

6. **Per-item loop on the main agent.** For each eligible `wordpressFile` in the order from step 5, in sequence:
   - Read `${CLAUDE_PLUGIN_ROOT}/references/refine-template.md` and apply its **Steps** section end-to-end to the source entry chosen for this group. Use the entry's stored `pageUrl` as the resolved site URL (step 4 already validated it).
   - **Preserve the discrepancy-table gate.** When the per-item procedure produces the discrepancy table (its step 4), present it to the user and wait for an explicit decision before applying any edits:
     - User approves → continue with steps 5–6 of the per-item procedure (apply edits, validate, re-screenshot, iterate). Final outcome `refined`.
     - User declines → record `aborted:user-declined` for this item and move on. No edits are applied.
     - Discrepancy table has zero in-scope rows → no gate needed. Final outcome `clean`.
     - Iteration reaches a point where remaining differences need human input (per the per-item procedure's step 6) → record `aborted:needs-human-input` for this item, file a GitHub issue describing what's blocked per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`, and move on.
   - Apply every guardrail in `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md` to any edit made. Validate every chunk of block markup via `mcp__wordpress-studio__validate_blocks` before writing. Verify cross-file properties (template-part slug references, preset resolution, `templateParts` registration, required blocks per template slug) against `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` and `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` before moving to the next item.
   - For any human-actionable follow-up that arises during this item (unwired nav labels, missing alt text, ambiguous asset, etc.), open a GitHub issue *immediately* per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`. Do not accumulate them for the final summary.
   - Once the item finishes, append exactly one outcome line to your in-memory running summary: `<entry-key> | <wordpressFile> | refined` (or `clean`, or `aborted:<reason>`, or `skipped:<reason>` if the per-item procedure aborted on a runtime precondition that the planning step couldn't see). Then move to the next item.

7. **Final summary.** After the last item, emit the standard summary per `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` ("Final summary"):
   - **Items processed**: entry key → `wordpressFile` → `pageUrl`. One line per item with its outcome (`refined` / `clean`).
   - **Items aborted**: one line each with reason (`user-declined`, `needs-human-input`).
   - **Items skipped, grouped by reason**: `not-built`, `missing-figmaNodes`, `no-pageUrl`, `--skip`, plus any per-item-precondition skips that arose during the loop.
   - **GitHub issues opened during the run**: URL + title for every issue filed by `gh issue create` across the loop (including the `aborted:needs-human-input` issues).
   - **Next step reminder**: remind the user to re-run `/refine-all-templates` once the human-input items are unblocked, and to run `/refine-content <name>` per entry to refine page bodies. There is no batch refine for content.

   The summary is the only place the final outcome is reported. Do not also output an inline "follow-ups for the human" list — every follow-up is already a GitHub issue.
