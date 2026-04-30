---
name: pull-figma
description: Walks the Figma dev-handoff page once and writes the structural data Neptune needs into neptune-config.json — template-mapping candidates (with desktop/mobile node ids), the style-guide pointer, every dev note's text and context, and the file's variable definitions. Used after `setup-project`. Triggers on phrases like "pull figma data", "sync the figma file", "refresh figma config", "re-pull design data".
---

This skill is safe to re-run — it overwrites figma-derived slices of `neptune-config.json` with the current state of the Figma file, but leaves user-edited fields (e.g. `wordpressFile` mappings on `templateMappings` entries, `pageUrl` values) untouched on existing keys.

Goal: walk the dev-handoff page **once** with `mcp__figma-local__get_metadata`, extract every piece of structural information the rest of the workflow needs, and persist it. Downstream skills (`map-design-templates`, `theme-json`, `extract-patterns`) then become pure config consumers.

Prerequisites:

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh setupProjectCompleted figmaFileId figmaDevHandoffNodeId`. If it fails, surface the message and stop.
2. Confirm the Figma file is open in Figma desktop. The local MCP cannot read content from a file that is not open. If unsure, run `${CLAUDE_PLUGIN_ROOT}/scripts/check-figma-mcp.sh` and verify the user has the project's Figma file as the active file.

## Steps

1. Read `figmaFileId` and `figmaDevHandoffNodeId` from `neptune-config.json`.

2. **Walk the dev-handoff page once.** Call `mcp__figma-local__get_metadata` with `nodeId = figmaDevHandoffNodeId`. The response is the full XML tree of the page — typically tens of kilobytes, with named sections (e.g. `🗒️ Templates`, `🎨 Style Guide`) plus nested instances and dev-note components throughout. Hold the response in memory; every subsequent slice operates on it without further MCP calls.

3. **Validate the page shape.** The walk expects two required named sections at the top level:
   - `🗒️ Templates` — title cards + layout instances.
   - `🎨 Style Guide` — visual rendering of palette, typography, spacing.

   If either is missing, stop and ask the user whether the dev-handoff page node id is correct. Open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` listing the section names that *were* found, so a designer can see what to rename.

4. **Slice `🗒️ Templates` into title-card candidates.** Title Cards are frames named `Title Card` within the section, each holding a single `<text>` child whose `name` attribute is the visible title (e.g. "Front Page", "Blog Post", "Default Page Template"). Layout frames are `<instance>` elements; their names usually echo the title (e.g. "Front Page – Desktop") but **do not always match** (e.g. title "Default Page Template" pairs with instance "Sub Page – Desktop"). **Pair by spatial association**, not by name and not by hard-coded coordinates:

   **Pairing rule.** For each layout instance L:
   - Compute L's horizontal centre: `Lc = L.x + L.width / 2`.
   - A title card T is a *spatial parent* of L when:
     - T sits **above** L: `T.y + T.height < L.y`.
     - T's horizontal range **contains** Lc: `T.x ≤ Lc ≤ T.x + T.width`.
   - If multiple title cards qualify (vertical stacking), pick the one closest above L by y-distance (smallest `L.y − (T.y + T.height)`).
   - If no title card qualifies under strict containment (e.g. a wide mobile-only column where the title card is narrower than the layout block, or a designer's grid puts the layout slightly outside the title card's x-range), fall back to: the title card whose horizontal centre is **nearest** to L's horizontal centre AND that sits above L. Surface this as a "weak match" in the run summary so the user can verify.

   This rule has no magic numbers — it scales to whatever spacing or grid the designer used, and tolerates designs where layouts and title cards are not vertically stacked at fixed y values.

   **Breakpoint assignment.** Group all layouts paired with a single title card and assign each by **closest standard breakpoint anchor**, not by ordinal position. Anchors:
   - `desktop` — width ≥ 1024
   - `tablet` — width 600–1023
   - `mobile` — width < 600

   These ranges are robust to designer variation: a 1280 desktop is as valid as 1440; a 375 mobile as valid as 402; a 768 tablet as valid as 820. Don't hard-code specific widths — bucket by range. If two layouts in the same group land in the same bucket (e.g. two desktop variants at 1280 and 1440), promote the wider one to `desktop` and surface the narrower as `desktop-alt` in the run summary; the user decides which to keep. If a title card has only one paired layout, assign it to the bucket its width falls into (single mobile-only layouts like a "Mobile Menu" should land in `mobile`, not `desktop`).

   Some title cards have only one variant (e.g. "Menu" pairs with a single mobile-only "Mobile Menu" frame). Capture what's there; mark missing variants in the run summary.

   Build a `templateMappings` object keyed by the title-card text:
   ```json
   {
     "Front Page": {
       "figmaTitleCardId": "5966:15577",
       "figmaTitleTextId": "5966:15578",
       "figmaNodes": {
         "desktop": "5966:10116",
         "mobile":  "5966:10117"
       },
       "proposedWordpressFile": "<best-guess from the title; see table below>"
     }
   }
   ```

   Propose `wordpressFile` per title from this table:
   | Title contains             | proposedWordpressFile             |
   | ---                        | ---                               |
   | "Front Page" / "Home"      | `front-page.html`                 |
   | "Blog" (without "Post")    | `index.html` (default posts list) |
   | "Blog Post" / "Single"     | `single.html`                     |
   | "Category" / "Archive"     | `archive.html`                    |
   | "Search"                   | `search.html`                     |
   | "404" / "Not Found"        | `404.html`                        |
   | "Default Page" / "Page"    | `page.html`                       |
   | "Menu" / "Mobile Menu"     | `parts/header.html` (or part)     |
   | anything else              | `page.html` (configurable)        |

   `proposedWordpressFile` is a hint — `map-design-templates` confirms each one with the user before scaffolding files. Do not write `wordpressFile` (the canonical key) here; that's `map-design-templates`'s output. **If `templateMappings` already exists in `neptune-config.json`** (re-run case), preserve any `wordpressFile`, `pageUrl`, and other user-confirmed keys on existing entries; refresh only `figmaNodes`, `figmaTitleCardId`, `figmaTitleTextId`, `proposedWordpressFile`. New entries get the full proposed shape.

5. **Capture a pointer to `🎨 Style Guide`.** Record the section's `id` as `figmaStyleGuideNodeId`. The actual visual extraction happens later in `theme-json`, which calls `get_design_context` on this node id — `pull-figma` only captures the address.

6. **Walk for `💬 Dev Note` instances.** Search the entire dev-handoff page tree for `<instance>` (or `<frame>`) elements whose `name` attribute is `💬 Dev Note` (or starts with `💬 Dev Note`). For each one, capture the position and size — but the note's actual text content lives in inner `<text>` children. **For each Dev Note, call `mcp__figma-local__get_design_context` once to fetch its text content.** The note's React+Tailwind output contains the visible string in plain text; extract it.

   This is the most expensive part of the pull (one MCP call per note; a typical file has 30–80 notes). If the user wants to skip Dev Note text extraction (e.g. for a fast re-pull), offer it once at the start of step 6 — they can confirm/decline. If skipped, persist the node ids only and set a `devNotesTextPending: true` flag.

   For each captured note, derive a stable identifier from the surrounding context (e.g. the nearest enclosing layout instance's name; falls back to `note-<short-hash>` if context is unclear). Write to:
   ```json
   {
     "devNotes": {
       "front-page-hero-cta": {
         "id": "5968:12192",
         "text": "<visible note text>",
         "context": "Front Page – Desktop, near the hero CTA",
         "x": 789,
         "y": 986
       }
     }
   }
   ```

7. **Pull variable definitions.** Call `mcp__figma-local__get_variable_defs` with `nodeId = figmaDevHandoffNodeId`. Persist the raw response under `figmaVariables` in `neptune-config.json`. `theme-json` reads this directly to populate palette / typography / spacing — no per-token re-fetch is required.

8. **Write everything to `neptune-config.json`.** Use a single `jq` invocation to merge the new slices into the existing config without losing other keys:
   ```bash
   jq --argjson new '<json blob>' '. * $new' neptune-config.json > /tmp/neptune-config-pull.json && \
     mv /tmp/neptune-config-pull.json neptune-config.json
   ```
   The `*` (recursive merge) ensures existing fields on `templateMappings` entries (like a previously-confirmed `wordpressFile` or `pageUrl`) survive the re-pull.

9. **Set `figmaPullCompleted: true`.** The boolean is the completion signal; the data lives across `templateMappings`, `figmaStyleGuideNodeId`, `devNotes`, and `figmaVariables`.

10. **Run summary.** Tell the user:
    - Number of template-mapping candidates captured (with their proposed WP files).
    - Whether the style-guide pointer was resolved.
    - Number of dev notes captured (and whether text was extracted or deferred).
    - Number of figma variables pulled.
    - Any sections that were missing or named differently than expected — surface as GitHub issues per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.

    Site-level brand assets (favicon, theme screenshot, social sharecard) are not captured by `pull-figma`. When `/build-template` or `/build-content` encounters one inside a page design, that command uploads it via `wp media import` and wires it up directly (`wp option update site_icon`, og-image meta, `screenshot.png` in the theme tree).

11. Load and follow the `map-design-templates` skill to continue.
