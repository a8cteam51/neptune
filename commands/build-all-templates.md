---
description: Build every unbuilt template and template part listed in `templateMappings` by running each through `/build-template`. Refinement is never triggered by this command — run `/refine-all-templates` or `/refine-template <name> <site-url>` separately.
argument-hint: [--skip=name1,name2]
---

Build all templates and template parts in `templateMappings` from `neptune-config.json` that are not yet built. `$ARGUMENTS` may contain an optional `--skip=<comma-separated-names>` flag to exclude specific mappings from this run (matched against the `templateMappings` keys, e.g. `--skip=404.html,search.html`). Treat `--skip` as optional — if it's absent, do not prompt for it. This command is **build-only** — it never invokes `/refine-template` itself, neither in subagents nor in the main agent.

This command is a batch wrapper around `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md`. Read that file first — every styling and building guardrail there applies to each template built in this run.

Each per-template build is delegated to a **subagent** (via the Agent tool). Subagents run **sequentially** — one at a time, never in parallel. Reasons:
- **Context budget.** The main agent would otherwise accumulate the Figma design context, generated block markup, and intermediate file reads for every template across the run, and run out of context before the batch finishes. Subagents let each template's working set live and die in a separate context.
- **Shared mutable state.** Theme files like `theme.json`, `functions.php`'s `register_block_style` registrations, and the `assets/block-styles/src/*.scss` tree are touched by multiple templates. Concurrent subagents would race on those files; sequencing avoids it.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — full per-template procedure.
- The same MCPs and skills `build-template` requires (`wp-blockmarkup`, Figma MCP + `figma:figma-use`, `wp-block-themes` skill).

Steps:

1. Read `templateMappings` from `neptune-config.json`. Group entries by `wordpressFile` — multiple Figma title cards can point to the same file (e.g. several page designs all using `page.html`). For each unique `wordpressFile`, check the file (relative to the theme root, found via `themeSlug`) and treat it as **unbuilt** if missing or empty (whitespace-only counts as empty), **already built** if it contains any block markup. Build runs once per unique unbuilt `wordpressFile`. For each unbuilt file, pick the most generic entry to source `figmaNodes` from (e.g. an entry titled "Default Page" beats "About Page"); if no entry is obviously generic, plan to ask the user during step 3. Stop and report if `templateMappings` is empty or missing — the user needs to run `/map-design-templates` first.
2. If `$ARGUMENTS` contains a `--skip=<names>` flag, parse it into a list (comma-separated, trimmed). `--skip` matches against `templateMappings` entry keys. Drop a `wordpressFile` from the build set only if **every** entry pointing at it is in the skip list; if at least one non-skipped entry remains, keep the file in the build set and use that entry's `figmaNodes`. If a skip entry does not match any key in `templateMappings`, warn the user that the name was unrecognized but continue.
3. Show the user the list of unbuilt `wordpressFile`s you intend to build, with the source entry chosen for each (and the other entries that share the file, noted as "content via `/build-content` later"), plus any explicitly skipped via `--skip`. Process template parts (e.g. `header.html`, `footer.html`) before full templates that include them, so any subsequent refinement run sees finished parts. Wait for the user to confirm before continuing — and resolve any "no obviously generic entry" cases here.
4. For each unbuilt `wordpressFile`, in the order from step 3, launch one subagent via the Agent tool to perform the per-template build. **Wait for each subagent to return before launching the next** — never run two concurrently, never use `run_in_background` for these. Use `subagent_type: "general-purpose"` and do **not** pass `isolation: "worktree"` — the subagent must write to the live theme tree.

   Each subagent's prompt must be self-contained, since it has no view of this conversation. Brief it with:
   - The source entry's key, the `wordpressFile` path, and the `figmaNodes` (desktop / mobile node IDs) for this template.
   - The `figmaFileId`, `themeSlug`, and `repositoryUrl` from `neptune-config.json` (the last is needed for `gh issue create`).
   - Only the `devNotes` entries that apply to this template — filter before sending; do not dump the whole array.
   - The list of sibling `templateMappings` entries that share this `wordpressFile`, so the subagent can correctly handle nav wiring and the "content via `/build-content` later" reminder.
   - An explicit instruction to read `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` and follow that procedure end-to-end, including all styling and building guardrails (no `wp:html` fallback, `register_block_style` workflow, internal-link wiring from `templateMappings`, GitHub issues for human follow-ups).
   - An explicit instruction **not** to invoke `/refine-template` itself — refinement is out of scope for this command entirely, and is run separately by the user via `/refine-all-templates` or `/refine-template`.
   - A short, structured report format to return: file written, GitHub issues opened (with URLs), unresolved follow-ups, any deviations from the build-template procedure. Cap the report at ~200 words so the main agent's context stays lean.

   Treat each subagent as an independent invocation: do not carry block markup or assumptions from one template's subagent into another beyond what's already shared via `theme.json` and registered block styles (which the next subagent will read fresh from disk).

5. After all templates are processed, output a summary aggregated from each subagent's report: built `wordpressFile`s, skipped (with reason, including `--skip` exclusions), any GitHub issues opened during the run, **and** the list of `templateMappings` entries that share an already-built `wordpressFile` and still need `/build-content` to fill their per-page body. Remind the user that this command does not refine — they should run `/refine-all-templates <site-url>` (or `/refine-template <name> <site-url>` per template) once they're ready to visual-diff against Figma — and `/build-content` once per entry for the per-page content fills.
