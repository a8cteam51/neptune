---
name: apply-diff
description: Use when applying a list of pre-approved visual diffs to an existing Gutenberg block markup template. Inputs are the diff list (JSON), the current block markup, and the active theme.json/variables.json. Output is a strict JSON envelope containing the updated block markup, any block-style registrations + CSS the diffs require, AND a per-diff applied/skipped report. Neptune persists block styles via wp-cli; do not call any tools yourself.
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
- Optionally `theme.json` — the theme's preset palette / typography / spacing slugs. Use these in attributes when they match.
- Optionally `variables.json` — the original Figma token map.
- Optionally a `=== dev annotations ===` section. Non-binding designer notes attached to specific regions; they may explain why a block looks the way it does (e.g. "placeholder for post content", "empty state"). Use them as context when judging whether to apply a diff — never as a reason to introduce a change that wasn't in `diffs.json`.
- Optionally a `=== placeholder image ===` section giving an attachment id and URL. When present, every `wp:image` block you emit (or modify) MUST use those values: set `"id":<id>` in the block attrs, `<img src="<url>" class="wp-image-<id>">`. Do not invent other URLs and do not leave `src` empty.

## Output format

Return ONLY a single JSON object. No markdown fences. No prose. Shape:

```jsonc
{
  "template_html": "<!-- wp:group ... --><!-- /wp:group -->",
  "block_styles": [
    {
      "block": "core/button",
      "name": "fill-small",
      "label": "Fill Small",
      "css": ".wp-block-button.is-style-fill-small { padding: 8px 16px; }"
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
- `block_styles`: zero or more block-style registrations the template needs. Empty array is fine.
- **`applied`**: one entry per diff id you successfully changed. `summary` is a short human-readable description of what you did (e.g. "Switched fontSize from 'medium' to preset 'large'"). Used for user feedback in the Neptune UI.
- **`skipped`**: one entry per diff id you DID NOT change, with a one-sentence `reason`. Examples: "Description didn't reference a block in current.html.", "Would require structural rewrite, beyond refinement scope.", "block_change suggested wp:gallery but no compatible image set exists."
- **Coverage is enforced.** Every diff id in the input `diffs.json` MUST appear in either `applied` or `skipped`. Neptune validates this and fails the run if any id is unaccounted for. Do NOT silently drop diffs.
- An id appears at most once across `applied` + `skipped`.

## When to add a block style

Prefer markup-only edits when a `theme.json` preset can express the change:

- Background colour matches a palette slug → use `backgroundColor` attribute.
- Font size matches a `typography.fontSizes` slug → use `fontSize` attribute.
- Padding/margin matches a `spacing.spacingSizes` slug → use `style.spacing.padding` / `var:preset|spacing|<slug>`.
- Block type is wrong → change the `wp:foo` name; no CSS work needed.

Add a block style ONLY when the visual change can't be expressed via a preset attribute. In that case:

1. Pick a `name` that's lowercase kebab-case and descriptive.
2. Pick a `label` that's title-case and human-readable.
3. Write the CSS scoped to `.wp-block-<block-without-namespace>.is-style-<name>`.
4. Apply `is-style-<name>` to the block's `className` attribute in `template_html`.

## What to do for each diff

1. Locate the affected region in `current.html` using `region` and `description` as guides.
2. Decide: markup-only edit, CSS-only edit, or both. Prefer markup-only when a preset works.
3. If you need a block-style variation: add to `block_styles[]` and apply the resulting class in the markup.
4. Record the change in `applied` with a short summary.
5. If you cannot apply a diff (ambiguous, would break markup, or you don't have enough context), record it in `skipped` with a one-sentence reason. Do not invent an edit.

## Rules

- Refinement, not rewrite. Untouched regions of `template_html` stay byte-for-byte (modulo whitespace) the same.
- Do NOT introduce new diffs. Apply only what's in `diffs.json`.
- Every block-style entry in `block_styles[]` MUST be referenced by a class in `template_html`.
- Every `is-style-<name>` class in `template_html` MUST appear in `block_styles[]`.
- CSS must be a single string scoped to `.wp-block-<block>.is-style-<name>`.
- If `diffs.json` is empty, return `{"template_html": "<unchanged>", "block_styles": [], "applied": [], "skipped": []}`.

## Self-check before responding

1. Output is exactly one JSON object, valid, no fences, no prose.
2. `template_html` starts with `<!-- wp:` and balances opening/closing block comments.
3. JSON inside every block comment attribute parses.
4. Every diff id in the input appears exactly once in `applied` or `skipped`.
5. Every `applied` entry has `id` + `summary`; every `skipped` entry has `id` + `reason`.
6. No prose, no fences.
