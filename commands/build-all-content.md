---
description: Fill the body content of every `templateMappings` entry whose target post is still empty, running each through `/build-content`.
argument-hint: [--skip=name1,name2]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh issue create:*), Bash(gh repo view:*), Bash(studio wp:*), Bash(rm:*), Bash(cat:*), Skill, mcp__figma__*, mcp__wp-blockmarkup__*
---

Fill the body content for every `templateMappings` entry in `neptune-config.json` whose target WP post is still empty (or carries only the WP default stub). `$ARGUMENTS` may contain an optional `--skip=<comma-separated-names>` flag to exclude specific mappings from this run (matched against `templateMappings` keys, e.g. `--skip=Blog,404 Page`). Treat `--skip` as optional — if it's absent, do not prompt for it. There is no base-site-URL argument here: each entry's `pageUrl` is the source of truth for which post to fill, and `pageUrl` was captured during `/map-design-templates`. This command is **build-only** — it never invokes `/refine-content` or `/refine-template`.

This command is a batch wrapper around `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md`. Read that file once before the loop — every guardrail there (no `wp:html` fallback, block markup only, `register_block_style` workflow, GitHub issues for human follow-ups, internal-link wiring from `templateMappings`) applies to each entry filled in this run. Read `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md` for the shared execution model (inline-only, pause every 2 items for `/compact`, never auto-refine, never auto-create posts, never overwrite filled posts).

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md` — full per-entry procedure.
- `${CLAUDE_PLUGIN_ROOT}/commands/build-template.md` — styling and building guardrails referenced from `/build-content`.
- The same MCPs and skills `/build-content` requires (`wp-blockmarkup`, Figma MCP + `figma:figma-use`, `wp-block-themes` skill, and `studio wp` access).

Steps:

1. Read `templateMappings` from `neptune-config.json`. Stop and report if `templateMappings` is empty or missing — the user needs to run `/map-design-templates` first. For each entry, treat it as **eligible** (in scope for this run) if all of the following hold: (a) `figmaNodes` is present and non-empty; (b) a `pageUrl` is present, or can be resolved from the entry's key during step 3. Skip with reason any entry that has no `figmaNodes` (note: re-run `/map-design-templates`) or no resolvable URL. Note: unlike `/build-all-templates`, this command does not group by `wordpressFile` — every entry has its own body content to fill regardless of which wrapper it shares.

2. If `$ARGUMENTS` contains a `--skip=<names>` flag, parse it into a list (comma-separated, trimmed) and drop any matching entry from the eligible set. If a skip entry does not match any key in `templateMappings`, warn the user that the name was unrecognized but continue.

3. For each remaining eligible entry, resolve the WP post ID by URL using the same lookup chain as `/build-content` step 3:
   - `studio wp eval "echo url_to_postid( '<page-url>' );"`
   - Fall back to `studio wp post list --post_type=any --name=<slug-from-url> --field=ID --format=ids` if `url_to_postid` returns `0`.
   If neither resolves a post ID, mark the entry as **skipped (post not found)** and continue — do not auto-create the post.

4. For each entry with a resolved post ID, check whether the post body is already filled. The cheapest signal is whether the post content contains any block delimiter:
   ```bash
   studio wp post get <id> --field=post_content | grep -q '<!-- wp:' && echo filled || echo empty
   ```
   Treat the entry as **already filled** (skip) if the body contains any `<!-- wp:` delimiter; otherwise treat it as **to fill**. If the user wants to overwrite already-filled posts, they should run `/build-content <name>` per entry — `/build-all-content` only fills empties to avoid clobbering work.

5. Show the user the plan: the list of entries you intend to fill (entry key → `pageUrl` → resolved post ID), plus any skipped entries grouped by reason (`--skip`, missing `figmaNodes`, no `pageUrl`, post not found, already filled). Wait for the user to confirm before continuing.

6. For each entry to fill, in `templateMappings` key order, follow the procedure in `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md` from step 4 onward (steps 1–3 there are covered by this run's steps 1, 3, and 4): pull the Figma design context for the entry's `figmaNodes`, apply `devNotes`, generate body block markup via `wp-blockmarkup`, write to a temp file, and update the post with `studio wp post update <id> --post_content="$(cat <tmpfile>)"`. Verify and clean up the temp file as in `/build-content` step 8. Do **not** invoke `/refine-content` or `/refine-template` after each fill — refinement is out of scope here. Filter `devNotes` per entry before reasoning over them; do not let unrelated notes pollute the build. Treat each entry as an independent fill: do not carry block markup or assumptions from one entry into another beyond what's already shared via `theme.json` and registered block styles (which are read fresh from disk).

7. **Pause after every 2 entries** per `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md`. The pause message should name the two entries just filled and list the remaining entries.

8. After all entries are processed, output the final summary per `${CLAUDE_PLUGIN_ROOT}/references/batch-policy.md`. Remind the user that `/refine-content <name> <page-url>` is the next step for body refinement on any newly filled page (and `/refine-template` for the wrapper) — `/build-all-content` does not auto-refine because refinement requires a rendered screenshot and the user may want to batch refinement separately via `/refine-all-content` or `/refine-all-templates`.
