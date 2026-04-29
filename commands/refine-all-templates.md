---
description: Visual-diff every built template and template part listed in `templateMappings` against its Figma design by spawning one subagent per item.
model: sonnet
argument-hint: <site-url> [--skip=name1,name2]
allowed-tools: Agent, Read, Edit, Write, Glob, Grep, Bash(curl:*), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Bash(gh issue create:*), Bash(gh repo view:*)
---

Orchestrate refinement of all built templates and template parts in `templateMappings` against their Figma designs. This command **runs as an orchestrator** — the actual per-item refinement happens inside subagents spawned via the `Agent` tool, one per unique built `wordpressFile`. Read `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` for the orchestrator/subagent contract.

`$ARGUMENTS` may contain a base site URL (e.g. `https://my-site.test`) used to derive per-template URLs for visual diffing, and an optional `--skip=<comma-separated-names>` flag (see `batch-policy.md` "Argument parsing"). If a site URL is not present in `$ARGUMENTS`, ask the user for one — refinement requires a rendered screenshot, so this command cannot run without one.

Figma is the source of truth for the design. Adjust the WordPress template to match Figma — never the other way around.

Preflight (run before planning):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted themeJsonCompleted templateMappings themeSlug figmaFileId` — fail fast if prior phases are incomplete.

Context to load:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- `${CLAUDE_PLUGIN_ROOT}/commands/refine-template.md` — the per-item refinement procedure each subagent will follow (including the measure-first / vision-fallback diff strategy).
- `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — referenced by `refine-template.md` for shared styling guardrails.
- `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` — orchestrator/subagent contract, `--skip` parsing, return-shape.

## Steps

1. **Plan.** Read `templateMappings`. Group entries by `wordpressFile` — refinement runs once per unique `wordpressFile` (the wrapper is shared; per-page content is `/refine-content`'s concern). For each unique `wordpressFile`, check the file (relative to the theme root, via `themeSlug`). Treat it as **built** (eligible for refinement) if it contains any block markup; treat it as **unbuilt** (skip) if missing or empty. For each eligible `wordpressFile`, pick the source entry whose `figmaNodes` and `pageUrl` will drive the refinement — prefer the most generic entry (e.g. "Default Page" beats "About Page"); plan to ask the user during step 3 if no entry is obviously generic. Skip a `wordpressFile` if the chosen source entry's `figmaNodes` is missing or empty — the user should re-run `/map-design-templates` to capture them. Stop and report if `templateMappings` is empty.

2. **Apply `--skip`.** Parse per `batch-policy.md` "Argument parsing". Grouped batches: a `wordpressFile` is dropped only if every entry pointing at it is in the skip list.

3. **Confirm with user.** Show the list of `wordpressFile`s you intend to refine, with the source entry chosen for each, plus any skipped mappings with their reason (unbuilt / missing Figma nodes / explicit `--skip`). Process template parts (e.g. `header.html`, `footer.html`) before full templates that include them, so each full template's refinement sees finished parts. Wait for the user to confirm — and resolve any "no obviously generic entry" cases here.

4. **Resolve URLs.** For each `wordpressFile`, resolve a `page-url` in this priority order: (a) the `pageUrl` field on the source entry from step 1 (preferred — captured by `/map-design-templates`); (b) derive from the base site URL using the WordPress template hierarchy. Derivation examples: `index.html` → site root, `single.html` → any published post URL, `archive.html` / `category.html` → an archive URL, `search.html` → `?s=<term>`, `404.html` → a deliberately broken slug, `page.html` or custom page templates → the slug of the page that uses that template. For template parts (`header.html`, `footer.html`), reuse the URL of the template they appear in. If neither (a) nor (b) resolves a URL confidently, ask the user. If the URL came from stored `pageUrl`, sanity-check with `curl -sf -o /dev/null -w '%{http_code}' '<url>'` before passing it to the subagent — a 4xx/5xx means stale; re-resolve or ask.

5. **Per-item subagent loop.** For each `wordpressFile`, in the order from step 3, spawn a subagent via the `Agent` tool with a self-contained prompt that:
   - States the project root, `themeSlug`, `figmaFileId`, and `repositoryUrl` (the full GitHub URL from `neptune-config.json`) — the subagent uses this directly for `gh issue create --repo <owner/repo>` without re-reading the config.
   - States the chosen source entry's key, `wordpressFile`, `figmaNodes`, and the resolved page URL.
   - Includes only the `devNotes` whose `context` plausibly applies to this template — filter at the orchestrator before spawning.
   - Instructs: "Read `${CLAUDE_PLUGIN_ROOT}/commands/refine-template.md` and follow it end-to-end for the entry above, with one divergence: do **not** pause to share the discrepancy table with the user — produce the table inline as part of your work and proceed to apply refinements. The user has already gated this batch. Refine against both `desktop` and `mobile` nodes where both are present, taking one screenshot per breakpoint. Apply the measure-first / vision-fallback diff strategy strictly. Validate any block-markup change via `mcp__wordpress-studio__validate_blocks` before writing it."
   - Demands the structured return shape from `batch-policy.md` "Subagent return contract", including a populated `DISCREPANCIES` block.
   - Tool budget: `Read, Edit, Write, Glob, Grep, Bash(npm run build:styles:block-styles), Bash(studio wp:*), Bash(curl:*), Bash(gh issue create:*), Bash(gh repo view:*), Skill, mcp__figma__*, mcp__wordpress-studio__*`.
   - Use the `subagent_type: "general-purpose"` agent. Pass `model: "sonnet"`.

6. **Between items.** Append the subagent's structured report (including its discrepancy table) to the running summary. Move to the next item. No `/compact` pause.

7. **Final summary.** After the loop, render the standard summary per `batch-policy.md` "Final summary". Concatenate per-item discrepancy tables under per-template headings. If any sibling entries shared a refined `wordpressFile`, list them and note that per-page differences belong in `/build-content` / `/refine-content` rather than another `/refine-template` pass. Remind the user to re-run `/refine-all-templates` (or `/refine-template <name>` for a single template) after any subsequent design changes in Figma.
