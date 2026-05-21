---
name: apply-diff
description: Use when applying a list of pre-approved visual diffs to existing Gutenberg block markup. Persists the updated markup back to its wp_post via Haydi MCP, optionally extends theme.json or registers block style variations as needed, flushes the WordPress cache, and reports per-diff applied/skipped outcomes for the host log.
---

# Apply visual diffs to block markup

Revise an existing WordPress block-theme template (or page post body) to apply a specific list of changes the user has already reviewed and approved. Do NOT re-evaluate whether the changes are correct — apply each one accurately and leave everything else alone.

## Operating mode

You convert + persist + report. The host loads the **pull-writer** skill alongside this one; pull-writer ships the canonical recipes for every persistence step.

Available tools:

- `Read`, `Glob`, `Grep` — for inspecting the local theme + sibling templates if you need to.
- `Edit`, `Write` — for local file edits (theme.json, `styles/blocks/*.json`).
- `mcp__haydi__haydi_run_php` — for the wp_template / wp_template_part / page / post writes and the cache flush. See pull-writer Recipes 2, 4, 5.
- NO `Task` (single-shot, no nested subagents). NO `Bash`.

Final response: terse plaintext summary lines for the host to parse. NO JSON envelope, NO markdown fences. Specifically:

- `APPLIED <id>: <one-line description>` — for every diff you successfully applied. The host displays these in the UI.
- `SKIPPED <id>: <one-sentence reason>` — for every diff you did NOT apply. Reason must explain WHY.
- One or more `wrote …` / `edited …` / `flushed …` lines, same shape as the other persistence skills.

**Coverage is enforced.** Every diff id in the input MUST appear in either an `APPLIED` line or a `SKIPPED` line — never both, never neither. The host fails the run if any id is unaccounted for.

## Scope vocabulary

Inline prompts dispatch by emitting a single `SCOPE: <TOKEN>` line that names which region the input `current.html` represents. Token names are STABLE — Neptune's prompt code references them, do not rename.

| Token               | `current.html` is                                          | Persist via              | Don't emit                                                                                             |
| ------------------- | ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `PAGE`              | A full-page template (header, body, footer all inline)     | pull-writer Recipe 2     | (none — full chrome allowed)                                                                           |
| `HEADER`            | `parts/header.html`                                        | pull-writer Recipe 2     | wp:post-content, wp:post-title, footer chrome, body content                                            |
| `FOOTER`            | `parts/footer.html`                                        | pull-writer Recipe 2     | wp:post-content, wp:post-title, header chrome, body content                                            |
| `WRAPPER`           | A template that embeds the page body via `wp:post-content` | pull-writer Recipe 2     | The page body subtree (keep `wp:post-content` placeholder verbatim)                                    |
| `POST-CONTENT-BODY` | The page's `post_content` only (NOT a template)            | pull-writer Recipe 4     | wp:template-part, wp:post-title, wp:post-date, wp:post-content, comments — those belong to the wrapper |

If a diff in `diffs.json` targets a region the active scope does not own, record it in `SKIPPED` with a reason that names the offending region. Do not invent edits in regions the scope excludes, and do not add chrome the scope's "Don't emit" column lists.

## Inputs the user gives you

- The task brief identifies the persistence target (template `type/slug/title` for SCOPE: PAGE/HEADER/FOOTER/WRAPPER, or page/post `postType/slug/title` for SCOPE: POST-CONTENT-BODY) and the theme paths.
- `current.html` — the existing Gutenberg block markup. This is what you edit.
- `diffs.json` — an array of approved diffs from the visual-diff agent. Each entry has:
  - `id`, `region`, `severity`, `description`
  - `block_change` (optional)
  - `style_change` (optional)
  - `affects_layout` (boolean)
- Optionally `theme.json` — the active theme's settings AND existing styles. Single source of truth for what's already registered project-wide. Read three subtrees deliberately:
  - `settings.color.palette` / `settings.typography.fontSizes` / `settings.spacing.spacingSizes` — preset slugs to prefer over inlined raw values.
  - `styles.blocks["core/<x>"]` — what's already styled at the block level. Your edits EXTEND this subtree (Recipe 6 deep-merges); they do not overwrite.
  - `settings.blocks["core/<x>"]` — per-block setting overrides; if a structured property isn't enabled, the editor won't surface the control.
- Optionally `variables.json` — the original Figma token map.
- Optionally `=== existing block style variations ===` — a JSON array of variations already registered for this theme. When a diff implies an alternative block style and one of these matches, REUSE it by applying the existing `is-style-<slug>` class — do NOT register a new variation file.
- Optionally a `=== dev annotations ===` section — non-binding designer notes attached to specific regions.
- Optionally a `=== media library mappings ===` section — mapped attachments + discarded SVG descriptions. See "Handling SVG and unmapped image references" below.

## Persistence flow

For every refine-apply run:

1. Compute the new markup by editing `current.html` per the approved diffs.
2. **Persist the markup first** via the scope's matching recipe (Recipe 2 for templates, Recipe 4 for POST-CONTENT-BODY). Markup is the load-bearing artifact — land it before anything else so a later failure doesn't leave the run with no markup written.
3. **Apply theme.json patches** if the diffs require new structured properties under `styles.blocks` or `settings.custom` (Recipe 6).
4. **Register block style variations** if the diffs require new editor-pickable styles (Recipe 7). Reuse existing ones from the context section first.
5. **Flush the cache** ONCE at the end via Recipe 5 — only if you touched theme.json or any variation file.
6. **Emit summary lines**: `wrote …`, `edited …`, `flushed …` for persistence, plus `APPLIED <id>: …` / `SKIPPED <id>: …` per diff.

## Where to put style information

Throughout this skill the names `theme_json_patch.blocks["core/<x>"]` and `block_style_variations[]` appear as mental shorthand for two on-disk destinations:

| Mental shorthand | Actual destination | Recipe |
|---|---|---|
| `theme_json_patch.blocks["core/<x>"]` | `theme.json`'s `styles.blocks["core/<x>"]` subtree | Recipe 6 |
| `theme_json_patch.custom` | `theme.json`'s `settings.custom` subtree | Recipe 6 |
| `block_style_variations[]` entry | one file at `styles/blocks/<slug>.json` | Recipe 7 |

### Priority order

For each style change implied by a diff, work top-down and stop at the first option that fits.

1. **A theme.json preset slug** already in `theme.json` — `{"backgroundColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`. Always prefer this when a preset matches.
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties (color/typography/spacing/border/elements). DEFAULT channel for any value that isn't a preset slug. Persisted via Recipe 6.
3. **An existing block style variation** — if `=== existing block style variations ===` contains an entry whose `styles` already matches what the diff calls for, apply its `is-style-<slug>` class. Do NOT register a duplicate.
4. **A new block style variation** — register one whenever the same constellation of styles will (or already does) appear on multiple instances of the same block type with a coherent visual identity. Persisted via Recipe 7. Forcing question: "would I otherwise inline these same styles on a sibling block of the same type?" If yes, register the variation.
5. **CSS** in a `.css` field — only when the rule cannot be expressed as a structured property (pseudo-selectors, descendant selectors, animations, complex states). Use `theme_json_patch.blocks["core/<x>"].css` for project-wide rules or a variation's `styles.css` for scoped ones.

There is NO step 6. Raw inline `style="..."` HTML attributes on the rendered HTML elements inside block markup are FORBIDDEN without exception. If a value seems instance-specific enough to want an inline style, it belongs in a variation file; promote it.

NEVER write to `styles.css` or any other top-level theme.json key. NEVER emit raw CSS outside `theme_json_patch.blocks.<x>.css` or a variation's `styles.css`. The site's `style.css` file is off-limits.

### Width and alignment

`theme.json.settings.layout.contentSize` and `wideSize` define the project-wide content and wide widths. Width on a block instance is expressed via the `align` attribute (`align:"wide"`, `align:"full"`, or omitted for `contentSize`) — NOT via per-block `layout.contentSize` / `layout.wideSize`. Side padding (`style.spacing.padding.left/right`) narrows further when needed.

When a diff calls for a width change:

- "Make this section wider" → set `align:"wide"` (or `align:"full"` if it should be edge-to-edge). Don't pin a custom `layout.contentSize` on the block.
- "Make this section narrower" → add `style.spacing.padding.left/right`, or apply / register a variation that owns the inset. Don't shrink via a custom `contentSize`.
- A diff that explicitly references a numeric content/wide width belongs in `settings.layout` (project-wide) — but `settings.layout` is outside the two allowed subtrees for Recipe 6 (which only writes `styles.blocks` and `settings.custom`). Record the diff in `SKIPPED` with reason "width change must update theme.json.settings.layout, which is outside this skill's scope" and let the user adjust theme.json directly.

Only fall through to per-instance `layout.contentSize`/`wideSize` when a single section legitimately departs from the project widths and `align` + padding cannot express it. This should be vanishingly rare.

## Custom design tokens

When a diff implies a value that's reused across multiple blocks (a recurring offset, a custom radius), register it at `theme_json_patch.custom.<group>.<name>` (Recipe 6) and reference it via `var(--wp--custom--<group>--<name>)` in your block-scoped CSS.

## Forms

If a diff targets a form region, expect the existing `current.html` to use Jetpack form blocks (`jetpack/contact-form` wrapping `jetpack/field-*` and a `jetpack/button` submit). Apply edits to those blocks and their attributes; do NOT replace a Jetpack field with a `wp:html` raw `<input>`, and do NOT replace `jetpack/button` with `core/button` for the submit.

Common edits and the right channel for each:

- Change a field's label / placeholder / required flag → the matching block attribute on `jetpack/field-*` (`label`, `placeholder`, `required`, `defaultValue`).
- Change which options appear in a select / radio / checkbox group → the `options` array on the field block; preserve unaffected entries verbatim.
- Lay out two fields side-by-side → set `width` on each field block (25 / 50 / 75 / 100).
- Restyle the submit button → attributes on the existing `jetpack/button` (`text`, `backgroundColor`, `textColor`, `borderRadius`, `width`).
- Spacing between the form and its surroundings → `style.spacing` on `jetpack/contact-form`.

If a diff implies a form region but `current.html` has no `jetpack/contact-form` wrapper, record the diff in `SKIPPED` with reason "form region missing jetpack/contact-form wrapper; needs a fresh build pass".

## Handling SVG and unmapped image references

A diff may instruct you to add or modify an image whose source const has no mapped entry in `=== media library mappings ===` (typically SVG: divider, ornament, icon). Do NOT emit a `wp:image` with empty `src` — WP renders it as a broken-image placeholder. Translate the visual's intent into a STRUCTURED block expression instead.

Combine three signals in this order — (1) the **discarded-entry description** if the const is listed there (highest signal), (2) the diff's own `description`, (3) the surrounding `current.html` and JSX context. For `[render failure]` entries treat the description as an error code — fall back to context alone.

Walk top-down and stop at the first option that fits:

1. **Decorative line / divider** → `wp:separator` or `border.top` / `bottom` / `left` / `right` on the parent block.
2. **Background ornament** → `style.color.background` / `style.color.gradient` on the parent block, or a `background-image` rule on a registered variation.
3. **Icon glyph used like an emoji** → drop the element entirely if purely decorative; emit `wp:html` ONLY when the icon is semantically required AND inline SVG bytes are in the diff or `current.html`.
4. **Last resort**: omit the element. Empty `wp:image` is NEVER acceptable.

If you can't decide, record the diff in `SKIPPED` with a reason naming the ambiguity. Do not invent an empty `wp:image` to "preserve" the element.

## What to do for each diff

1. Locate the affected region in `current.html` using `region` and `description` as guides.
2. Decide: markup-only edit, structured-prop edit, CSS edit, variation registration, or some combination. Use the priority order above.
3. If you register a variation, add the matching `is-style-neptune-<name>` class to the relevant block in the markup.
4. Once all diffs are processed, persist via the recipes in the order above.
5. After persistence, emit one `APPLIED <id>: …` line per applied diff and one `SKIPPED <id>: …` line per skipped diff.

## Rules

- Refinement, not rewrite. Untouched regions of the markup stay byte-for-byte (modulo whitespace) the same.
- Do NOT introduce new diffs. Apply only what's in `diffs.json`.
- NEVER add or leave a raw HTML `style="..."` attribute (including `style=""`) on the rendered HTML inside block markup. If `current.html` already has such attributes from an older build, removing them as part of the diffs you're applying is in scope; reproducing them is not.
- Do NOT set instance-level `"style":{...}` JSON block attributes either, except for the canonical `"style":{"spacing":{"blockGap":"var:preset|spacing|<slug>"}}` on layout containers.
- Do NOT pin `contentSize` or `wideSize` on `wp:group`'s `layout`. Width is `align:"wide"` / `align:"full"` / no align, or side padding for narrower content.
- Every block style variation file you write MUST have its `is-style-<slug>` class applied to at least one block in the persisted markup.
- Every `is-style-neptune-<name>` class in the markup MUST be backed EITHER by an existing-variations inventory entry OR by a newly-written variation file — never both, never neither.
- Variation slugs MUST be `neptune-` prefixed (kebab-case) so they don't collide with theme defaults.
- If `diffs.json` is empty, do nothing (no recipe calls). Emit only an `APPLIED 0` / `SKIPPED 0` summary line plus a single comment line `no diffs to apply`.

## Self-check before responding

1. Markup persisted via Recipe 2 (template) or Recipe 4 (page/post). theme.json edits via Recipe 6 if needed. Variation files via Recipe 7 if needed. Recipe 5 (cache flush) ONCE iff Recipe 6 or 7 ran.
2. Markup starts with `<!-- wp:` and balances opening/closing block comments. JSON inside every block comment attribute parses.
3. theme.json edits ONLY touch `styles.blocks` and `settings.custom`. No `variations` field anywhere inside `styles.blocks["core/<x>"]` — variations live in their own files via Recipe 7.
4. Every diff id in the input appears EXACTLY ONCE in either an `APPLIED <id>:` or `SKIPPED <id>:` summary line. Coverage is enforced by the host.
5. Every variation file's slug is `neptune-` prefixed AND its `is-style-<slug>` class appears on at least one block. Every `is-style-neptune-<slug>` class is backed by EITHER an existing inventory entry OR a newly-written file — never both, never neither.
6. Markup contains zero raw HTML `style="..."` attributes (including empty `style=""`) and zero instance-level `"style":{...}` block attributes — except the canonical `style.spacing.blockGap` on layout containers.
7. No `wp:group` declares its own `contentSize` or `wideSize` under `layout`. Width is `align` + side padding only.
8. CSS only used when no pre-exposed structured property could express the rule.
