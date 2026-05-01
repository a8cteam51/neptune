# Batch command execution policy

This file describes the shared execution model for Neptune's batch commands: `/build-all-templates`, `/build-all-content`, and `/refine-all-templates`.

**Build batches are non-interactive between items.** `/build-all-templates` and `/build-all-content` write validated markup directly and only stop for human input when a precondition fails (missing `figmaNodes`, no `pageUrl`, etc.).

**Refine batches preserve the per-item discrepancy-table gate.** `/refine-all-templates` automates planning, screenshot capture, Figma pulls, diffing, and the final summary, but each item still pauses to show its discrepancy table and waits for explicit approval before applying changes. The batch is "the per-item refine command, in a loop, with shared planning and reporting" — not a hands-off run.

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
- `refined` — the discrepancy table produced rows, the user approved, and the changes were applied and re-verified (refine-all-templates).
- `clean` — the discrepancy table produced no in-scope rows; nothing to apply (refine-all-templates).
- `aborted:<reason>` — the user declined at the discrepancy gate, or remaining differences require human input. Refine-only outcome. Common reasons: `user-declined`, `needs-human-input`.
- `skipped:<reason>` — see the per-command "already done" rules and the `--skip` rules below. Common reasons: `--skip`, `already-built`, `already-filled`, `not-built`, `missing-figmaNodes`, `no-pageUrl`, `post-not-found`.

### Tool access

Batch commands inherit the same MCP and tool access the per-item slash command requires. They do **not** need `Agent` in `allowed-tools` — there is no subagent. Each batch command's frontmatter `allowed-tools` should match its per-item counterpart (build-template.md / build-content.md / refine-template.md) plus anything the planning step needs (`Bash(jq:*)` for filtering, `Bash(test:*)` for file existence checks, etc.).

## Argument parsing

### `--skip=<comma-separated-names>`

Optional in every batch command. Treated identically across both:

- Parse on `,` and trim whitespace per token.
- Match each token against the **keys** of `templateMappings` in `neptune-config.json`. Matching is case-sensitive and exact; the keys are the Figma title-card names captured by `/map-design-templates`.
- Tokens that match no key produce a single warning line ("`--skip` token \"X\" did not match any templateMappings key — ignoring") and the batch continues.
- For `/build-all-templates` and `/refine-all-templates` (both group by `wordpressFile`): a `wordpressFile` is dropped from the eligible set only if **every** entry pointing at it is in the skip list. If any non-skipped entry remains, the file stays in the set and the non-skipped entry is used as its source.
- For `/build-all-content` (which acts per entry): a matched entry is removed from the eligible set directly.

If `--skip=` is absent, never prompt for it.

### Site URL argument

Per-command — see each batch command's frontmatter `argument-hint` for whether it takes a base URL.

## What batch commands never do

- **Never invoke refinement from a build batch.** `/build-all-templates` and `/build-all-content` are build-only. Refinement is its own batch (`/refine-all-templates`) or per-item (`/refine-template`, `/refine-content`); a build batch never auto-chains into one.
- **Never bypass the per-item discrepancy gate in a refine batch.** `/refine-all-templates` shows each item's discrepancy table and waits for explicit approval before applying changes. The user can decline (`aborted:user-declined`) and the loop moves on.
- **Never auto-create posts.** If a `pageUrl` does not resolve to an existing WP post, mark the entry as `skipped:post-not-found` and continue.
- **Never overwrite already-built wrappers in `/build-all-templates`.** Treat any target `wordpressFile` that exists and contains at least one `<!-- wp:` block delimiter as already built and skip it. The user runs `/build-template <name>` per entry to overwrite.
- **Never overwrite filled posts in `/build-all-content`.** Treat any post whose `post_content` contains a `<!-- wp:` block delimiter as already filled and skip it. The user runs `/build-content <name>` per entry to overwrite.
- **Never refine a wrapper that hasn't been built yet in `/refine-all-templates`.** Treat any target `wordpressFile` that doesn't exist on disk, or that exists without a `<!-- wp:` block delimiter, as `skipped:not-built`. The user runs `/build-template <name>` to build it first.
- **Never spawn subagents and never run items in parallel.** See "Execution mode" and "Why sequential, not parallel" above.

## Follow-ups during a batch run

For every human-actionable follow-up surfaced during any item — unwired nav labels, missing alt text, ambiguous asset triage, etc. — open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` *during that item's run*. Do not collect a list of follow-ups in memory and emit them as inline bullets in the final summary instead of filing issues — that is explicitly forbidden by the followups policy. The final summary references the issue URLs that were filed; it is not the destination for new follow-up text.

## Final summary

After every item has been processed, the main agent outputs:

- **Items processed**: entry key → resolved post ID and/or `wordpressFile` → `pageUrl`. One line per item with its outcome (`built` / `filled` / `refined` / `clean`).
- **Items aborted**: refine-only — entries the user declined at the discrepancy gate or that need human input. One line each with reason.
- **Items skipped, grouped by reason**: `--skip` exclusion, already built, already filled, not built (refine), missing `figmaNodes`, no `pageUrl`, post not found.
- **GitHub issues opened during the run**: URL + title, collected from each item's `gh issue create` calls.
- **Next step reminder**: for build batches, remind the user to run `/refine-all-templates` once they can view rendered output, or per-item `/refine-template` / `/refine-content` for finer control. For `/refine-all-templates`, remind the user to re-run on items that were `aborted` after addressing the human-input items, and to run `/refine-content <name>` per entry to refine page bodies.
