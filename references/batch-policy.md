# Batch command execution policy

This file describes the shared execution model for Neptune's two batch commands: `/build-all-templates` and `/build-all-content`.

**Batches are build-only.** There is no `/refine-all-templates` and no `/refine-all-content`. Refinement is per-item by design — `/refine-template` and `/refine-content` produce a discrepancy table the user reviews before changes are applied, and that interactive gate is incompatible with a batch loop. The user runs `/refine-template <name>` / `/refine-content <name>` per item when ready to visual-diff. If a workflow ever needs "refine many", that is the user invoking the per-item refine command in their own order, not a Neptune batch.

## Execution mode: sequential, on the main agent

Batch commands run **inline on the main agent, one item at a time**. There is no subagent fan-out and no `Agent` tool invocation. The main agent loops over the eligible item set, applying the per-item command's procedure (e.g. `commands/build-template.md`) to each entry in order, and writes a single combined summary at the end.

Why on the main agent (not subagents):

- **Context capacity is sufficient.** Neptune's main-agent window comfortably holds a full multi-template build. The previous subagent model existed to fence off context bloat; in practice the per-template payload is small enough (one Figma `get_design_context` plus the file edit) that the main window handles 10–20 items without measurable degradation.
- **One execution path, not two.** Per-item commands and batch commands share the exact same procedure. Removing the subagent indirection means the batch is "the per-item command, in a loop" — no separate prompt template, no return-contract serialization, no risk of the subagent and per-item commands drifting apart over time.
- **Direct tool access.** The main agent already has every MCP and Bash permission the per-item command needs. No need to declare `Agent` in `allowed-tools` or pass `repositoryUrl` through a subagent prompt — it's all already in scope.

Why sequential, not parallel:

- **Shared mutable state.** Theme files like `theme.json`, `register_block_style` registrations in `functions.php`, and the `assets/block-styles/src/*.scss` tree are touched by multiple items. Parallel item runs would race on these. Sequential runs that write to disk between items see each other's outputs cleanly.
- **DB writes for content commands.** `studio wp post update` is also shared mutable state.
- **Block validation is sequential anyway.** Each `mcp__wordpress-studio__validate_blocks` call is a single round-trip; parallelizing them across items doesn't save wall-clock if the bottleneck is the validator.

## The per-item loop

Each batch command's main agent is responsible for:

1. **Plan.** Read `templateMappings` from `neptune-config.json`, group/filter according to the per-command rules (build-all-templates groups by `wordpressFile`; build-all-content acts per entry), parse `--skip` (see "Argument parsing"), apply the per-command "already built/filled" exclusion, determine the eligible item set, and present it to the user for confirmation. Wait for confirmation before processing anything.
2. **Per-item loop.** For each eligible item, in order:
   - Read the per-item command file (`commands/build-template.md` or `commands/build-content.md`) and apply its steps for the current entry, with two divergences: (a) skip the "ask the user which entry" step — the entry is already chosen for this iteration; (b) skip the auto-suggestion of `/refine-*` at the end of the per-item command. The build batch is build-only.
   - As soon as the item finishes, append a one-line outcome to the running summary in memory: `<entry-key> | <wordpressFile or post ID> | built | filled | skipped:<reason>`. Plus the issue URLs from any `gh issue create` calls made during that item.
   - Then move to the next item. Do not re-quote the full per-item working trace into the running summary — only the outcome line plus any issue URLs.
3. **Final summary.** Once every item has been processed, emit the standard summary (see "Final summary" below).

### Item outcome shape

Every item ends with one of these resolved outcomes:

- `built` — the wrapper was generated, validated, and written to disk (build-all-templates).
- `filled` — the post body was generated, validated, and written via `studio wp post update` (build-all-content).
- `skipped:<reason>` — see the per-command "already done" rules and the `--skip` rules below. Common reasons: `--skip`, `already-built`, `already-filled`, `missing-figmaNodes`, `no-pageUrl`, `post-not-found`.

These are the only outcomes a build batch produces. There is no `refined` outcome — refinement does not run inside the batch.

### Tool access

Build batch commands inherit the same MCP and tool access the per-item slash command requires. They do **not** need `Agent` in `allowed-tools` — there is no subagent. Each batch command's frontmatter `allowed-tools` should match its per-item counterpart (build-template.md / build-content.md) plus anything the planning step needs (`Bash(jq:*)` for filtering, `Bash(test:*)` for file existence checks, etc.).

## Argument parsing

### `--skip=<comma-separated-names>`

Optional in every batch command. Treated identically across both:

- Parse on `,` and trim whitespace per token.
- Match each token against the **keys** of `templateMappings` in `neptune-config.json`. Matching is case-sensitive and exact; the keys are the Figma title-card names captured by `/map-design-templates`.
- Tokens that match no key produce a single warning line ("`--skip` token \"X\" did not match any templateMappings key — ignoring") and the batch continues.
- For `/build-all-templates` (which groups by `wordpressFile`): a `wordpressFile` is dropped from the eligible set only if **every** entry pointing at it is in the skip list. If any non-skipped entry remains, the file stays in the set and the non-skipped entry is used as its source.
- For `/build-all-content` (which acts per entry): a matched entry is removed from the eligible set directly.

If `--skip=` is absent, never prompt for it.

### Site URL argument

Per-command — see each batch command's frontmatter `argument-hint` for whether it takes a base URL.

## What batch commands never do

- **Never invoke refinement from a build batch.** `/build-all-templates` and `/build-all-content` are build-only. The user runs `/refine-template` / `/refine-content` per item when ready to visual-diff. There is no Neptune command that runs refinement in a loop.
- **Never auto-create posts.** If a `pageUrl` does not resolve to an existing WP post, mark the entry as `skipped:post-not-found` and continue.
- **Never overwrite already-built wrappers in `/build-all-templates`.** Treat any target `wordpressFile` that exists and contains at least one `<!-- wp:` block delimiter as already built and skip it. The user runs `/build-template <name>` per entry to overwrite.
- **Never overwrite filled posts in `/build-all-content`.** Treat any post whose `post_content` contains a `<!-- wp:` block delimiter as already filled and skip it. The user runs `/build-content <name>` per entry to overwrite.
- **Never spawn subagents and never run items in parallel.** See "Execution mode" and "Why sequential, not parallel" above.

## Follow-ups during a batch run

For every human-actionable follow-up surfaced during any item — unwired nav labels, missing alt text, ambiguous asset triage, etc. — open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` *during that item's run*. Do not collect a list of follow-ups in memory and emit them as inline bullets in the final summary instead of filing issues — that is explicitly forbidden by the followups policy. The final summary references the issue URLs that were filed; it is not the destination for new follow-up text.

## Final summary

After every item has been processed, the main agent outputs:

- **Items processed**: entry key → resolved post ID and/or `wordpressFile` → `pageUrl`. One line per item with its outcome (`built` / `filled`).
- **Items skipped, grouped by reason**: `--skip` exclusion, already built, already filled, missing `figmaNodes`, no `pageUrl`, post not found.
- **GitHub issues opened during the run**: URL + title, collected from each item's `gh issue create` calls.
- **Next step reminder**: the user should run `/refine-template <name>` / `/refine-content <name>` per item when ready to visual-diff. No batch refine exists.
