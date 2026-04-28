# Batch command execution policy

This file describes the shared execution model for Neptune's four batch commands: `/build-all-templates`, `/build-all-content`, `/refine-all-templates`, `/refine-all-content`.

## Execution mode

Batch operations run **inline in the main agent**, sequentially. Do not spawn subagents per item.

Reasons:
- **Prompt-cache reuse.** The system prompt and MCP tool schemas are the largest fixed token cost in this stack. They cache once and hit on every subsequent call within the same conversation. Spawning a subagent per item re-pays that cost on every spawn.
- **Shared mutable state.** Theme files like `theme.json`, `register_block_style` registrations in `functions.php`, and the `assets/block-styles/src/*.scss` tree are touched by multiple items. Sequential inline execution avoids any race window.

## Compaction cadence

The loop pauses **after every 2 items**. When items 2, 4, 6, … finish, stop and tell the user:

> "<Built|Filled|Refined> `<item-N-1>` and `<item-N>`. Run `/compact` now to free context, then reply when you'd like me to continue with `<remaining-items>`."

Wait for the user's reply before resuming. After `/compact` runs, the conversation summary preserves the plan, the order, and the tally of completed items — enough to pick up with the next 2. Re-read any state you need from disk or the database (theme files, `theme.json`, `studio wp post get …`) rather than relying on conversation memory.

If only one item remains in the run, finish it without pausing — there is nothing left to compact for.

If context pressure forces an auto-compact mid-item during a refinement, finish the current item before pausing for the user-initiated `/compact`.

## Shared state hygiene

After finishing each item, write its outputs to disk (block markup → theme file or `studio wp post update`, any `theme.json` / `register_block_style` / block-stylesheet edits → their respective files) **before** starting the next, so subsequent items read the finished state from disk rather than from conversation history.

## What batch commands never do

- **Never invoke refinement from a build batch.** `/build-all-templates` and `/build-all-content` are build-only. The user runs `/refine-all-*` (or per-item refine) separately when ready to visual-diff.
- **Never auto-create posts.** If a `pageUrl` does not resolve to an existing WP post, mark the entry as `skipped (post not found)` and continue. Auto-creating risks duplicates.
- **Never overwrite filled posts in `/build-all-content`.** Treat any post whose `post_content` contains a `<!-- wp:` block delimiter as already filled and skip it. The user runs `/build-content <name>` per entry to overwrite.

## Discrepancy-table policy in refine batches

Per-item `/refine-template` and `/refine-content` say "share the discrepancy table with the user before making changes." In a batch run the user has already opted into refinement at the plan-confirmation step, so produce the table inline as part of each item's output and proceed to apply refinements without an extra per-item gate. The final summary collates all tables (and any deferred wrapper findings, in `/refine-all-content`).

## Final summary

After all items are processed, output a summary with:
- Items processed (entry key → resolved post ID and/or `wordpressFile` → `pageUrl`, breakpoints covered for refine).
- Items skipped, grouped by reason (`--skip` exclusion, missing `figmaNodes`, no `pageUrl`, post not found, post empty, already filled).
- All discrepancy tables (refine batches), concatenated under per-item headings.
- Any GitHub issues opened during the run (URL + title).
- A reminder of what the user's next step is (`/refine-*` after a build batch; re-running the batch after design changes for refine batches).
