---
name: apply-diff
description: Use when applying a list of pre-approved visual diffs to an existing Gutenberg block markup template. Inputs are the diff list (JSON), the current block markup, and the active theme.json/variables.json. Output is a strict JSON envelope containing the updated block markup, an optional theme.json patch (for project-wide style registrations), AND a per-diff applied/skipped report. Neptune persists the patch directly; do not call any tools yourself.
---

# Apply visual diffs to block markup

You revise an existing WordPress block-theme template to apply a specific list of changes that the user has already reviewed and approved. You do NOT re-evaluate whether the changes are correct — your job is to apply each one accurately and leave everything else alone.

## Inputs the user gives you

- `current.html` — the existing Gutenberg block markup. This is what you edit.
- `diffs.json` — an array of approved diffs from the visual-diff agent. Each entry has:
  - `id`, `region`, `severity`, `description`
  - `block_change` (optional)
  - `style_change` (optional)
  - `affects_layout` (boolean)
- Optionally `theme.json` — the active theme's settings AND existing styles. Single source of truth for what's already registered project-wide. Read three subtrees deliberately:
  - `settings.color.palette` / `settings.typography.fontSizes` / `settings.spacing.spacingSizes` — preset slugs to prefer over inlined raw values.
  - `styles.blocks["core/<x>"]` — what's already styled at the block level. Your `theme_json_patch.blocks["core/<x>"]` EXTENDS this subtree (Neptune deep-merges); it does not overwrite. Read it before patching so you know what's already covered.
  - `settings.blocks["core/<x>"]` — per-block setting overrides; if a structured property isn't enabled, the editor won't surface the control.
- Optionally `variables.json` — the original Figma token map.
- Optionally `=== existing block style variations ===` — a JSON array of variations already registered for this theme (slug, title, blockTypes, styles). When a diff implies an alternative block style and one of these matches, REUSE it by applying the existing `is-style-<slug>` class — do NOT redeclare it in `block_style_variations[]`.
- Optionally a `=== dev annotations ===` section. Non-binding designer notes attached to specific regions; they may explain why a block looks the way it does (e.g. "placeholder for post content", "empty state"). Use them as context when judging whether to apply a diff — never as a reason to introduce a change that wasn't in `diffs.json`.
- Optionally a `=== placeholder image ===` section giving an attachment id and URL. When present, every `wp:image` block you emit (or modify) MUST use those values: set `"id":<id>` in the block attrs, `<img src="<url>" class="wp-image-<id>">`. Do not invent other URLs and do not leave `src` empty.

## Output format

Return ONLY a single JSON object. No markdown fences. No prose. Shape:

```jsonc
{
  "template_html": "<!-- wp:group ... --><!-- /wp:group -->",
  "theme_json_patch": {
    "blocks": {
      "core/heading": {
        "typography": { "letterSpacing": "-0.02em" }
      }
    }
  },
  "block_style_variations": [
    {
      "slug": "neptune-fill-small",
      "title": "Fill Small",
      "blockTypes": ["core/button"],
      "styles": {
        "spacing": { "padding": { "top": "8px", "right": "16px", "bottom": "8px", "left": "16px" } }
      }
    }
  ],
  "applied": [
    {
      "id": "hero-heading-level",
      "summary": "Changed wp:paragraph to wp:heading level=1"
    },
    {
      "id": "footer-spacing",
      "summary": "Switched padding to var:preset|spacing|lg"
    }
  ],
  "skipped": [
    {
      "id": "card-hover",
      "reason": "Description didn't reference a specific block in current.html."
    }
  ]
}
```

### Field rules

- `template_html`: the COMPLETE replacement for `current.html`. Must start with `<!-- wp:` and contain matching opening/closing block comments.
- `theme_json_patch` (optional): omit when the diffs need no project-wide style change. When present, must contain only `blocks` and/or `custom`. Neptune deep-merges these into `theme.json`'s `styles.blocks` and `settings.custom` subtrees; all other theme.json keys are off-limits. Do NOT put `variations` under `theme_json_patch.blocks.<x>` — variations live in `block_style_variations`.
- `block_style_variations` (optional): array of editor-pickable block style variations. Each entry becomes `<theme>/styles/blocks/<slug>.json` (auto-registered by WP 6.6+). Required keys per entry: `slug` (kebab-case, MUST start with `neptune-`), `title` (string), `blockTypes` (non-empty array of `core/x` or `vendor/x`), `styles` (theme.json `styles` shape — color/typography/spacing/border/elements/blocks/css; settings/patterns/templates not allowed).
- **`applied`**: one entry per diff id you successfully changed. `summary` is a short human-readable description of what you did (e.g. "Switched fontSize from 'medium' to preset 'large'"). Used for user feedback in the Neptune UI.
- **`skipped`**: one entry per diff id you DID NOT change, with a one-sentence `reason`.
- **Coverage is enforced.** Every diff id in the input `diffs.json` MUST appear in either `applied` or `skipped`. Neptune validates this and fails the run if any id is unaccounted for. Do NOT silently drop diffs.
- An id appears at most once across `applied` + `skipped`.

## Where to put style information

The default channel for styling a block is `theme_json_patch.blocks["core/<x>"]` — extending what's already in `theme.json.styles.blocks`. Inline `style` attributes on individual blocks are an exception, not a fallback, and require justification at three checks (see step 6). When in doubt, register; don't inline.

### Priority order

For each style change implied by a diff, work top-down and stop at the first option that fits.

1. **A theme.json preset slug** already in `theme.json` — `{"backgroundColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`. Always prefer this when a preset matches.
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties (color/typography/spacing/border/elements). DEFAULT channel for any value that isn't a preset slug. Read what's already at `theme.json.styles.blocks["core/<x>"]` first; your patch extends that subtree. Inherits cleanly, stays editable in the Site Editor, never duplicates across templates.
3. **An existing block style variation** — if `=== existing block style variations ===` contains an entry whose `styles` already matches what the diff calls for, apply its `is-style-<slug>` class. Do NOT redeclare in `block_style_variations[]`.
4. **A new block style variation** in `block_style_variations[]` — register one whenever the same constellation of styles will (or already does) appear on multiple instances of the same block type with a coherent visual identity. Forcing question: "would I otherwise inline these same styles on a sibling block of the same type?" If yes, register the variation. The criterion is recurrence + coherence, NOT whether an editor user might switch styles.
5. **CSS** in a `.css` field — only when the rule cannot be expressed as a structured property (pseudo-selectors, descendant selectors, animations, complex states). Use `theme_json_patch.blocks["core/<x>"].css` for project-wide rules or a variation's `styles.css` for scoped ones.
6. **Raw inline `style` attribute on a block** — exception path. Allowed only when ALL THREE hold:
   - (a) No preset matches (step 1 fails).
   - (b) The value is unique to this single block instance — does NOT appear on any sibling block of the same type in `current.html`, and you would not write the same value on a future sibling.
   - (c) The value would not naturally extend `theme.json.styles.blocks["core/<x>"]` for this block type — i.e. it's genuinely instance-specific, not a default the block type should inherit.
   If any of (a)–(c) fails, promote to step 2 or step 4.

NEVER write to `styles.css` or any other top-level theme.json key. NEVER emit raw CSS outside `theme_json_patch.blocks.<x>.css` or a variation's `styles.css`. The site's `style.css` file is off-limits.

## Custom design tokens

When a diff implies a value that's reused across multiple blocks (a recurring offset, a custom radius), register it at `theme_json_patch.custom.<group>.<name>` and reference it via `var(--wp--custom--<group>--<name>)` in your block-scoped CSS.

## What to do for each diff

1. Locate the affected region in `current.html` using `region` and `description` as guides.
2. Decide: markup-only edit, structured-prop edit, CSS edit, variation registration, or some combination. Use the priority order above.
3. If you register a variation, add the matching `is-style-neptune-<name>` class to the relevant block in `template_html`.
4. Record the change in `applied` with a short summary.
5. If you cannot apply a diff (ambiguous, would break markup, or you don't have enough context), record it in `skipped` with a one-sentence reason. Do not invent an edit.

## Rules

- Refinement, not rewrite. Untouched regions of `template_html` stay byte-for-byte (modulo whitespace) the same.
- Do NOT introduce new diffs. Apply only what's in `diffs.json`.
- Every entry in `block_style_variations[]` MUST have its `is-style-<slug>` class applied to at least one block in `template_html`.
- Every `is-style-neptune-<name>` class you add to `template_html` MUST be backed EITHER by an entry in the existing-variations inventory OR by a new entry in `block_style_variations[]` — never both. Do not redeclare a slug that's already registered.
- Variation slugs MUST be `neptune-` prefixed (kebab-case) so they don't collide with theme defaults.
- If `diffs.json` is empty, return `{"template_html": "<unchanged>", "applied": [], "skipped": []}` (omit `theme_json_patch` and `block_style_variations`).

## Self-check before responding

1. Output is exactly one JSON object, valid, no fences, no prose.
2. `template_html` starts with `<!-- wp:` and balances opening/closing block comments.
3. JSON inside every block comment attribute parses.
4. If `theme_json_patch` is present, it has only `blocks` and/or `custom` at the top level — no `variations` anywhere inside.
5. Every diff id in the input appears exactly once in `applied` or `skipped`.
6. Every `applied` entry has `id` + `summary`; every `skipped` entry has `id` + `reason`.
7. Every entry in `block_style_variations` has its matching `is-style-<slug>` class somewhere in `template_html`.
8. Every `is-style-neptune-<slug>` class on a block in `template_html` is backed EITHER by an entry in the existing-variations inventory OR by a new entry in `block_style_variations[]` — never both.
9. CSS only used when no pre-exposed structured property could express the rule.
10. For every inline `style` attribute on a block in `template_html`, all three checks pass: (a) no theme.json preset matches, (b) no sibling block of the same type carries the same inline value, (c) the value would not naturally extend `theme.json.styles.blocks["core/<x>"]` for that block type. Any failure means promote to `theme_json_patch.blocks` or a `block_style_variations[]` entry.
11. No prose, no fences.
