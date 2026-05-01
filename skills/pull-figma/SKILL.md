---
name: pull-figma
description: Walks the Figma dev-handoff page once and writes the structural data Neptune needs into neptune-config.json — template-mapping candidates (with desktop/mobile node ids), the style-guide pointer, every dev note's text and context, and the file's variable definitions. Used after `setup-project`.
---

This skill is safe to re-run — it overwrites figma-derived slices of `neptune-config.json` with the current state of the Figma file, but leaves user-edited fields (e.g. `wordpressFile` mappings on `templateMappings` entries, `pageUrl` values) untouched on existing keys.

Goal: walk the dev-handoff page **once** with `mcp__figma__get_metadata`, extract every piece of structural information the rest of the workflow needs, and persist it. Downstream skills (`map-design-templates`, `theme-json`) then become pure config consumers.

Prerequisites:

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh setupProjectCompleted figmaFileId figmaDevHandoffNodeId`. If it fails, surface the message and stop.
2. Confirm the Figma MCP is connected — the `mcp__figma__*` tools must be available. The walk uses `figmaFileId` plus node IDs from `neptune-config.json` to address content; the file does not need to be open in any desktop app.

## Steps

1. Read `figmaFileId` and `figmaDevHandoffNodeId` from `neptune-config.json`.

2. **Walk the dev-handoff page once.** Call `mcp__figma__get_metadata` with `nodeId = figmaDevHandoffNodeId`. The response is the full XML tree of the page — typically tens of kilobytes, with named sections (e.g. `🗒️ Templates`, `🎨 Style Guide`) plus nested instances and dev-note components throughout. Hold the response in memory; every subsequent slice operates on it without further MCP calls.

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

6. **Walk for `💬 Dev Note` instances and extract their text.** Search the metadata response from step 2 for `<instance>` (or `<frame>`) elements whose `name` attribute is `💬 Dev Note` (or starts with `💬 Dev Note`). For each, capture id, x, y, width, height from the metadata.

   **Text must come from per-instance `get_design_context` calls.** Component-instance overrides do not surface in `get_metadata` — the instance is rendered as a reference to the master component, and its `<text>` children belong to the component definition, not the instance's overridden values. Page-level `get_design_context` on `figmaDevHandoffNodeId` collapses these instances into self-closing tags and is also unusable as a fallback. The only call that materializes the overridden note text is `mcp__figma__get_design_context` invoked with the **instance's own node id**.

   For each Dev Note instance found in metadata, call `mcp__figma__get_design_context` with `nodeId = <that instance's id>`. **Issue these calls in parallel** — emit many tool calls in a single response message rather than awaiting each in sequence; wall-clock cost for 50+ notes stays in the low single-digit seconds. From each response, read the rendered text content (the visible characters in the returned JSX/markup); concatenate multi-line content with newlines. If a specific instance still returns no text (truly malformed), record `text: ""` and flag it in the run summary.

   The earlier prohibition on per-note calls was based on the assumption that metadata carried the override text. It does not. Per-note `get_design_context` is required, not optional — but parallelization keeps the cost bounded.

   **Associate each note to its nearest layout by edge distance, not strict containment.** Notes commonly sit in the gutter between layouts with pointer arrows pointing at the design — they are not enclosed by any layout, but they're clearly *for* the nearest one. For each note:
   - Compute the note's centre `(cx, cy) = (x + width/2, y + height/2)`.
   - For every layout instance `L` already captured in step 4 (across every `templateMappings` entry's `figmaNodes`, combining desktop / tablet / mobile), compute the rectangle distance from the note's centre to `L`'s bounding box:
     - `dx = max(0, L.x - cx, cx - (L.x + L.width))`
     - `dy = max(0, L.y - cy, cy - (L.y + L.height))`
     - `distance = sqrt(dx² + dy²)` (zero when the note's centre is inside `L`).
   - Pick the layout with the smallest distance. The note's `context` becomes `<title-card-name> – <breakpoint>` (e.g. `Front Page – Desktop`). Notes inside a layout naturally get distance 0 and are still associated correctly.

   This rule never produces a null association — every note attaches to whichever layout is nearest, even when it sits in a gutter between two. Notes whose distance is more than 4× the median note→layout distance are still associated, but flagged in the run summary as "weak association — verify manually" so the user can inspect them.

   For each captured note, write to:
   ```json
   {
     "devNotes": {
       "front-page-1": {
         "id": "5968:12192",
         "text": "<visible note text>",
         "context": "Front Page – Desktop",
         "x": 789,
         "y": 986
       }
     }
   }
   ```
   Derive the key from the associated layout's title-card name plus a numeric suffix that disambiguates multiple notes on the same layout (`front-page-1`, `front-page-2`, …) in `(y, x)` reading order.

7. **Pull variable definitions.** Call `mcp__figma__get_variable_defs` with `nodeId = figmaDevHandoffNodeId`. Persist the raw response under `figmaVariables` in `neptune-config.json`. `theme-json` reads this directly to populate palette / typography / spacing — no per-token re-fetch is required.

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
