---
description: Build every templateMappings entry whose target wrapper file is empty/unbuilt — sequentially, on the main agent. Build-only; refinement is per-item.
argument-hint: [--skip=name1,name2]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh issue create:*), Bash(gh repo view:*), Bash(npm run build:styles:block-styles), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Bash(curl:*), Bash(jq:*), Bash(test:*), Bash(grep:*), Bash(wc:*), Skill, mcp__figma__*, mcp__wordpress-studio__*
---

Build every `templateMappings` entry whose target wrapper file does not yet exist or is empty, in one sequential pass on the main agent. This command is the batch analogue of `/build-template <name>`; the per-item procedure is unchanged.

Read `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` before starting — it spells out the execution model (main agent, sequential, no subagents, build-only, no refine), the `--skip` argument rules, and what the final summary must contain.

Preflight (run before any other step):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted themeJsonCompleted templateMappings themeSlug figmaFileId` — fail fast if prior phases are incomplete.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`, `repositoryUrl`.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — the per-item procedure each iteration applies.
- `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md` — every styling, validation, building, and accessibility/performance/SEO guardrail there applies to every iteration.
- `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` — allow-list of blocks for every chunk this batch emits.
- `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` — `theme.json` keys; resolve every preset reference against this contract.
- `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` — execution policy.
- `${CLAUDE_PLUGIN_ROOT}/references/reading-design-context.md` — translation contract for `mcp__figma__get_design_context`. Apply per item.
- `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` — every human-actionable follow-up during the run becomes a GitHub issue. Inline lists of TODOs in the final summary are forbidden.
- The Figma MCP — Figma is the source of truth. Confirm the `mcp__figma__*` tools are available before kicking off the loop. Each iteration addresses content by `figmaFileId` + node IDs from `neptune-config.json`.
- The `wordpress-studio` MCP — block markup must be validated through `mcp__wordpress-studio__validate_blocks` for every item.

## Steps

1. **Group entries by `wordpressFile`.** Read `templateMappings`. Multiple entries can share a single `wordpressFile` (e.g. several page designs all pointing to `page.html`); `/build-template` builds the wrapper **once** per file. Group accordingly. For each group, pick the source entry the same way `/build-template` does: prefer the most generic entry (e.g. an entry titled "Default Page" over "About Page"); if no entry is obviously generic, defer the choice to the user at confirmation time (step 4).

2. **Apply `--skip`.** Parse `$ARGUMENTS` for `--skip=<comma-separated>` per `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` ("Argument parsing"). A `wordpressFile` group is dropped from the eligible set only if **every** entry pointing at it is in the skip list. Tokens that do not match any `templateMappings` key produce one warning line and the run continues.

3. **Determine "not built" status per file.** A `wordpressFile` is considered already built (and is excluded from this run as `skipped:already-built`) when both:
   - The file exists at `wordpress/wp-content/themes/<themeSlug>/<wordpressFile>` (resolve `<themeSlug>` from `neptune-config.json`).
   - The file's contents include at least one `<!-- wp:` block delimiter.

   Use `test -s <path>` for existence + non-empty, then `grep -q '<!-- wp:' <path>` for the block-delimiter check. A file that exists but is empty (the scaffold from `/map-design-templates`) or that contains only whitespace/comments without a real block is treated as **not built** and stays in the eligible set. Also treat a missing `figmaNodes` (object absent or empty) on the source entry as a hard skip with reason `skipped:missing-figmaNodes` — `/build-template` cannot proceed without node IDs and we will not pause the batch to ask.

4. **Confirm the plan with the user.** Print the eligible groups (one row per `wordpressFile`, listing the source entry, its `figmaNodes`, and its `pageUrl`), the rows excluded as `already-built`, the rows excluded by `--skip`, and the rows excluded as `missing-figmaNodes`. If any group's source entry was ambiguous in step 1, ask the user to pick. Wait for explicit confirmation ("yes", "go", or equivalent) before doing any work.

5. **Per-item loop on the main agent.** For each eligible `wordpressFile` in the order from step 4, in sequence:
   - Read `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` and apply its **Steps** section to the source entry chosen for this group, with two divergences:
     - Skip the "ask the user which template or part this run will build" gate at the top of step 1 — the entry is already chosen for this iteration. The rest of step 1 (sibling-entry handling) still applies.
     - Skip step 8's auto-suggestion of `/refine-template` at the end. Build batches do not call refine. Per the batch policy, refinement is per-item and the user runs `/refine-template <name>` themselves when ready.
   - Apply every guardrail in `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md`. Validate every chunk of block markup via `mcp__wordpress-studio__validate_blocks` before writing. Verify cross-file properties (template-part slug references, preset resolution, `templateParts` registration, required blocks per template slug) against `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` and `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` before moving to the next item.
   - For any human-actionable follow-up that arises during this item (unwired nav labels, missing alt text, ambiguous asset, etc.), open a GitHub issue *immediately* per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`. Do not accumulate them for the final summary.
   - Once the item finishes, append exactly one outcome line to your in-memory running summary: `<entry-key> | <wordpressFile> | built` (or `skipped:<reason>` if the per-item procedure aborted on a precondition like `no-pageUrl` for a part that needs one). Then move to the next item.

6. **Final summary.** After the last item, emit the standard build-batch summary per `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` ("Final summary"):
   - **Items built**: entry key → `wordpressFile` → `pageUrl` (where applicable). One line per item.
   - **Items skipped, grouped by reason**: `already-built`, `--skip`, `missing-figmaNodes`, plus any per-item-precondition skips that arose during the loop.
   - **GitHub issues opened during the run**: URL + title for every issue filed by `gh issue create` across the loop.
   - **Next step reminder**: remind the user to run `/build-content <name>` per entry to fill body content for templates whose wrappers were just built (each entry sharing a `wordpressFile` still has its own body to fill), and `/refine-template <name> <site-url>` per template once they can view the rendered output. There is no batch refine.

   The summary is the only place the final outcome is reported. Do not also output an inline "follow-ups for the human" list — every follow-up is already a GitHub issue.
