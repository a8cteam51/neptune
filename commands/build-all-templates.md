---
description: Build every unbuilt template and template part listed in `templateMappings` by spawning one subagent per item. Refinement is never triggered by this command — run `/refine-all-templates` or `/refine-template <name> <site-url>` separately.
model: sonnet
argument-hint: [--skip=name1,name2]
allowed-tools: Agent, Read, Edit, Write, Glob, Grep, Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Bash(gh issue create:*), Bash(gh repo view:*)
---

Orchestrate a build of every unbuilt template and template part in `templateMappings` from `neptune-config.json`. This command **runs as an orchestrator** — the actual per-item work happens inside subagents spawned via the `Agent` tool, one per unique unbuilt `wordpressFile`. Read `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` for the full execution model and the orchestrator/subagent contract.

`$ARGUMENTS` may contain an optional `--skip=<comma-separated-names>` flag to exclude specific mappings (matched against `templateMappings` keys, e.g. `--skip=404.html,search.html`). See "Argument parsing" in `batch-policy.md` for the shared parsing rules. This command is **build-only** — it never invokes `/refine-template`.

Preflight (run before planning):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted themeJsonCompleted templateMappings themeSlug figmaFileId` — fail fast if prior phases are incomplete.

Context to load:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`, optional `patterns`.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — the per-item procedure each subagent will follow.
- `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` — orchestrator/subagent contract, `--skip` parsing, return-shape.

## Steps

1. **Plan.** Read `templateMappings`. Group entries by `wordpressFile` — multiple Figma title cards can point to the same file (e.g. several page designs all using `page.html`). For each unique `wordpressFile`, locate the file (relative to the theme root, found via `themeSlug`) and treat it as **unbuilt** if missing or empty (whitespace-only counts as empty), **already built** if it contains any block markup. Build runs once per unique unbuilt `wordpressFile`. For each unbuilt file, pick the most generic entry to source `figmaNodes` from (e.g. an entry titled "Default Page" beats "About Page"); if no entry is obviously generic, plan to ask the user during step 3. Stop and report if `templateMappings` is empty — the user needs to run `/map-design-templates` first.

2. **Apply `--skip`.** Parse per `batch-policy.md` "Argument parsing". For grouped batches: a `wordpressFile` is dropped only if every entry pointing at it is in the skip list; otherwise the non-skipped entry remains the source.

3. **Confirm with user.** Show the list of unbuilt `wordpressFile`s you intend to build, with the source entry chosen for each (and the other entries that share the file, noted as "content via `/build-content` later"), plus any explicitly skipped via `--skip`. Process template parts (e.g. `header.html`, `footer.html`) before full templates that include them, so any subsequent refinement run sees finished parts. Wait for the user to confirm before continuing — and resolve any "no obviously generic entry" cases here.

4. **Per-item subagent loop.** For each unbuilt `wordpressFile`, in the order from step 3, spawn a subagent via the `Agent` tool with a self-contained prompt that:
   - States the project root, `themeSlug`, `figmaFileId`, and `repositoryUrl` (the full GitHub URL from `neptune-config.json`) — the subagent uses this directly for `gh issue create --repo <owner/repo>` without re-reading the config.
   - States the chosen source entry's key, the `wordpressFile`, the `figmaNodes`, and the `pageUrl`.
   - Includes only the `devNotes` whose `context` plausibly applies to this template — filter at the orchestrator before spawning. Do not hand the subagent the full notes blob.
   - Lists the registered `patterns` slugs (if any) that the subagent may reference by slug rather than re-emit.
   - Instructs: "Read `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` and follow steps 1–9 for the entry above. Skip step 1's user-confirm — the entry is already chosen. Skip step 6's auto-invocation of `/refine-template` — refinement is out of scope for this batch. Validate every chunk of generated block markup via `mcp__wordpress-studio__validate_blocks` before writing it. Apply every accessibility/performance/SEO guardrail in that file."
   - Demands the structured return shape from `batch-policy.md` "Subagent return contract".
   - The subagent's tool budget is the same as `/build-template`'s — give it `Read, Edit, Write, Glob, Grep, Bash(...) , Skill, mcp__figma__*, mcp__wordpress-studio__*`.
   - Use the `subagent_type: "general-purpose"` agent. Pass `model: "sonnet"` to match `/build-template`'s default.

5. **Between items.** When a subagent returns, append its structured report to the orchestrator's running summary (do not re-process its prose). Move to the next item. Do not pause for `/compact` — context isolation is the subagent's job, not the orchestrator's.

6. **Final summary.** After the loop, render the standard summary per `batch-policy.md` "Final summary". In addition to the standard fields, list the `templateMappings` entries that share an already-built `wordpressFile` and still need `/build-content` to fill their per-page body. Remind the user that this command does not refine — they should run `/refine-all-templates <site-url>` (or `/refine-template <name> <site-url>` per template) once ready to visual-diff against Figma, and `/build-content` once per entry for the per-page content fills.
