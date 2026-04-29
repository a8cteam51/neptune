---
description: Fill the body content of every `templateMappings` entry whose target post is still empty by spawning one subagent per entry.
model: sonnet
argument-hint: [--skip=name1,name2]
allowed-tools: Agent, Read, Edit, Write, Glob, Grep, Bash(studio wp:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Bash(gh issue create:*), Bash(gh repo view:*)
---

Orchestrate body-content fills for every `templateMappings` entry in `neptune-config.json` whose target WP post is still empty (or carries only the WP default stub). This command **runs as an orchestrator** — the actual per-entry work happens inside subagents spawned via the `Agent` tool, one per eligible entry. Read `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` for the orchestrator/subagent contract.

`$ARGUMENTS` may contain an optional `--skip=<comma-separated-names>` flag to exclude specific mappings (matched against `templateMappings` keys, e.g. `--skip=Blog,404 Page`). See "Argument parsing" in `batch-policy.md`. There is no base-site-URL argument here: each entry's `pageUrl` is the source of truth for which post to fill, captured during `/map-design-templates`. This command is **build-only** — it never invokes `/refine-content` or `/refine-template`.

Preflight (run before planning):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted templateMappings themeSlug figmaFileId` — fail fast if prior phases are incomplete.

Context to load:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`, optional `patterns`.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md` — the per-entry procedure each subagent will follow.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — referenced by `build-content.md` for shared guardrails.
- `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` — orchestrator/subagent contract, `--skip` parsing, return-shape.

## Steps

1. **Plan.** Read `templateMappings`. Stop and report if it is empty — the user needs to run `/map-design-templates` first. For each entry, treat it as **eligible** if all of the following hold: (a) `figmaNodes` is present and non-empty; (b) a `pageUrl` is present, or can be resolved from the entry's key during step 3. Skip with reason any entry that has no `figmaNodes` (note: re-run `/map-design-templates`) or no resolvable URL. Note: unlike `/build-all-templates`, this command does not group by `wordpressFile` — every entry has its own body content to fill regardless of which wrapper it shares.

2. **Apply `--skip`.** Parse per `batch-policy.md` "Argument parsing". Per-entry batches: matched entries are removed from the eligible set directly.

3. **Resolve post IDs and filled state.** For each remaining eligible entry, resolve the WP post ID by URL using the same lookup chain as `/build-content` step 3 (`studio wp eval "echo url_to_postid( '<page-url>' );"`, falling back to `studio wp post list --post_type=any --name=<slug-from-url> --field=ID --format=ids`). If neither resolves a post ID, mark the entry as `skipped:post-not-found` and continue — do not auto-create the post. For each entry with a resolved post ID, check whether the post body is already filled with the cheap signal:
   ```bash
   studio wp post get <id> --field=post_content | grep -q '<!-- wp:' && echo filled || echo empty
   ```
   Treat the entry as `skipped:already-filled` if the body contains any `<!-- wp:` delimiter; otherwise treat it as **to fill**. Users overwrite individual entries with `/build-content <name>`.

4. **Confirm with user.** Show the plan: the list of entries you intend to fill (entry key → `pageUrl` → resolved post ID), plus any skipped entries grouped by reason. Wait for the user to confirm before continuing.

5. **Per-item subagent loop.** For each entry to fill, in `templateMappings` key order, spawn a subagent via the `Agent` tool with a self-contained prompt that:
   - States the project root, `themeSlug`, `figmaFileId`.
   - States the entry key, the `wordpressFile`, the `figmaNodes`, the `pageUrl`, and the resolved post ID.
   - Includes only the `devNotes` whose `context` plausibly applies to this entry's body — filter at the orchestrator before spawning.
   - Lists the registered `patterns` slugs (if any) that the subagent may reference.
   - Instructs: "Read `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md` and follow steps 1–13 for the entry above. Skip step 1's user-confirm and step 3's post-ID resolution — both are already done. Skip step 11's auto-suggestion of `/refine-content` — refinement is out of scope for this batch. Validate every chunk of generated block markup via `mcp__wordpress-studio__validate_blocks` before writing it back. Apply every accessibility/performance/SEO guardrail from `build-template.md`."
   - Demands the structured return shape from `batch-policy.md` "Subagent return contract".
   - Tool budget: `Read, Edit, Write, Glob, Grep, Bash(studio wp:*), Bash(rm:*), Bash(cat:*), Skill, mcp__figma__*, mcp__wordpress-studio__*`.
   - Use the `subagent_type: "general-purpose"` agent. Pass `model: "sonnet"`.

6. **Between items.** Append the subagent's structured report to the running summary. Move to the next entry. No `/compact` pause.

7. **Final summary.** After the loop, render the standard summary per `batch-policy.md` "Final summary". Remind the user that `/refine-content <name> <page-url>` is the next step for body refinement on any newly filled page (and `/refine-template` for the wrapper) — `/build-all-content` does not auto-refine because refinement requires a rendered screenshot and the user may want to batch refinement separately via `/refine-all-content` or `/refine-all-templates`.
