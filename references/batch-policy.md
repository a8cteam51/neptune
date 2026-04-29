# Batch command execution policy

This file describes the shared execution model for Neptune's four batch commands: `/build-all-templates`, `/build-all-content`, `/refine-all-templates`, `/refine-all-content`.

## Execution mode: subagent per item

Batch commands run **one subagent per item, sequentially**, orchestrated from the main agent. The orchestrator never executes the per-item procedure inline.

Why subagents:
- **Context isolation.** A 10-template build dragging every previous template's block markup, screenshots, and Figma payload through the same window degrades quality on later items. Each subagent gets a fresh ~200k-token window with only the artifacts it needs.
- **No `/compact` dance.** The previous inline-with-pause model required the user to type `/compact` every two items. Subagents make that unnecessary — the orchestrator's window stays small because each item's working state lives in the subagent.
- **Predictable concurrency.** Even though items run sequentially (not in parallel — see "Shared mutable state" below), the orchestrator's prompt is identical for every item, which improves prompt-cache hits across the run.

Why sequential, not parallel:
- **Shared mutable state.** Theme files like `theme.json`, `register_block_style` registrations in `functions.php`, and the `assets/block-styles/src/*.scss` tree are touched by multiple items. Parallel subagents would race on these. Sequential subagents that write to disk between items see each other's outputs cleanly.
- **DB writes for content commands.** `studio wp post update` is also shared mutable state.

## The orchestrator/subagent contract

Each batch command's orchestrator is responsible for:

1. **Plan.** Read `templateMappings` from `neptune-config.json`, group/filter according to the per-command rules below, parse `--skip` (see "Argument parsing"), determine the eligible item set, and present it to the user for confirmation. Wait for confirmation before spawning anything.
2. **Per-item loop.** For each eligible item, in the order from step 1:
   - Spawn a subagent with the contract below.
   - On return, append the subagent's structured report to the orchestrator's running summary. Do not re-process the per-item details — keep them compact.
3. **Final summary.** Once all subagents have returned, emit the standard summary (see "Final summary" below).

The orchestrator must **not** re-derive or re-fetch what the subagent already produced. It treats each subagent's report as opaque except for the fields the summary needs.

### Subagent prompt template

Each subagent receives a self-contained prompt that:

- States the project root, `themeSlug`, `figmaFileId`.
- States the entry key, `wordpressFile`, `figmaNodes`, `pageUrl`.
- Includes only the `devNotes` whose `context` field plausibly applies to this item (orchestrator filters before spawning — never hand the subagent the full notes blob).
- Instructs the subagent to read `${CLAUDE_PLUGIN_ROOT}/commands/<per-item-command>.md` and follow its steps for the entry above, with two divergences spelled out explicitly: (a) skip the "ask the user which entry" step — the entry is already chosen; (b) for build batches, skip the auto-suggestion of `/refine-*` at the end.
- Tells the subagent to return a structured report at the end (see below).

### Subagent return contract

Every subagent returns the same compact shape, regardless of which batch invoked it:

```
ITEM: <entry-key>
FILE: <wordpressFile or post ID>
RESULT: built | filled | refined | skipped:<reason>
ISSUES_OPENED:
  - <github-issue-url> | <title>
DISCREPANCIES (refine only):
  - <category> | <severity> | <one-line-summary>
NOTES:
  <one or two sentences of any deviation, assumption, or thing the human should know>
```

The orchestrator captures these reports and renders them in the final summary. It does **not** quote the subagent's full prose back to the user — only the structured fields above.

### Tool budget for subagents

Subagents inherit the same MCP and tool access the per-item slash command requires. They are spawned via the `Agent` tool from the orchestrator. Allowed-tools on each batch command must include `Agent` for this to work.

## Argument parsing

### `--skip=<comma-separated-names>`

Optional in every batch command. Treated identically across all four:

- Parse on `,` and trim whitespace per token.
- Match each token against the **keys** of `templateMappings` in `neptune-config.json`. Matching is case-sensitive and exact; the keys are the Figma title-card names captured by `/map-design-templates`.
- Tokens that match no key produce a single warning line ("`--skip` token \"X\" did not match any templateMappings key — ignoring") and the batch continues.
- For `build-all-templates` / `refine-all-templates` (which group by `wordpressFile`): a `wordpressFile` is dropped from the eligible set only if **every** entry pointing at it is in the skip list. If any non-skipped entry remains, the file stays in the set and the non-skipped entry is used as its source.
- For `build-all-content` / `refine-all-content` (which act per entry): a matched entry is removed from the eligible set directly.

If `--skip=` is absent, never prompt for it.

### Site URL argument

Per-command — see each batch command's frontmatter `argument-hint` for whether it takes a base URL.

## What batch commands never do

- **Never invoke refinement from a build batch.** `/build-all-templates` and `/build-all-content` are build-only. The user runs `/refine-all-*` (or per-item refine) separately when ready to visual-diff.
- **Never auto-create posts.** If a `pageUrl` does not resolve to an existing WP post, mark the entry as `skipped:post-not-found` and continue.
- **Never overwrite filled posts in `/build-all-content`.** Treat any post whose `post_content` contains a `<!-- wp:` block delimiter as already filled and skip it. The user runs `/build-content <name>` per entry to overwrite.
- **Never spawn parallel subagents.** See "Why sequential, not parallel" above.

## Discrepancy-table policy in refine batches

Per-item `/refine-template` and `/refine-content` say "share the discrepancy table with the user before making changes." In a batch run the user has already opted into refinement at the plan-confirmation step, so the subagent produces the table inline as part of its work and proceeds to apply refinements without an extra per-item gate. The orchestrator's final summary collates each subagent's table (and any deferred wrapper findings, in `/refine-all-content`).

## Final summary

After all subagents have returned, the orchestrator outputs:

- **Items processed**: entry key → resolved post ID and/or `wordpressFile` → `pageUrl`, breakpoints covered for refine.
- **Items skipped, grouped by reason**: `--skip` exclusion, missing `figmaNodes`, no `pageUrl`, post not found, post empty, already filled.
- **Discrepancy tables (refine batches)**: concatenated under per-item headings, with a separate "deferred to `/refine-template`" section for wrapper rows surfaced by `/refine-all-content`.
- **GitHub issues opened during the run**: URL + title, taken from each subagent's `ISSUES_OPENED` field.
- **Next step reminder**: `/refine-*` after a build batch; re-running the batch after design changes for refine batches.
