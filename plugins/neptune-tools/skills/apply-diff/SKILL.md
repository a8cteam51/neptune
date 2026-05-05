---
name: apply-diff
description: Use when applying a list of pre-approved visual diffs to an existing Gutenberg block markup template. Inputs are the diff list (JSON), the current block markup, and the active theme.json/variables.json. Output is a strict JSON envelope containing the updated block markup AND any block-style registrations + CSS the diffs require. Neptune persists block styles via wp-cli; do not call any tools yourself.
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
      "css": ".wp-block-button.is-style-fill-small { padding: 8px 16px; font-size: 14px; }"
    }
  ]
}
```

- `template_html`: the COMPLETE replacement for `current.html`. Must start with `<!-- wp:` and contain matching opening/closing block comments.
- `block_styles`: zero or more block-style registrations the template needs. Empty array is fine. Each entry combines registration metadata and CSS — Neptune will:
  1. Add `{block, name, label}` to the `NEPTUNE_BLOCK_STYLES` constant in `wp-config.php` (the theme reads this and calls `register_block_style` for each entry).
  2. Insert the `css` into Customizer "Additional CSS" inside section markers keyed by `block` and `name`.

If a block style for the same `(block, name)` already exists, Neptune updates it. You don't need to check first.

## When to add a block style

Prefer markup-only edits when a `theme.json` preset can express the change:

- Background colour matches a palette slug → use `backgroundColor` attribute.
- Font size matches a `typography.fontSizes` slug → use `fontSize` attribute.
- Padding/margin matches a `spacing.spacingSizes` slug → use `style.spacing.padding` / `var:preset|spacing|<slug>`.
- Block type is wrong → change the `wp:foo` name; no CSS work needed.

Add a block style ONLY when the visual change can't be expressed via a preset attribute — e.g. an unusual underline-on-hover, a custom border treatment, a specific gradient overlay. In that case:

1. Pick a `name` that's lowercase kebab-case and descriptive (`fill-small`, `outline-tight`, `underline-hover`).
2. Pick a `label` that's title-case and human-readable (`Fill Small`, `Outline Tight`).
3. Write the CSS scoped to `.wp-block-<block-without-namespace>.is-style-<name>` so it only applies when the variation is selected.
4. Apply `is-style-<name>` to the block's `className` attribute in `template_html`.

## Rules

- Refinement, not rewrite. Untouched regions of `template_html` stay byte-for-byte (modulo whitespace) the same.
- Do NOT introduce new diffs. Apply the supplied list, nothing else.
- Every block-style entry MUST be referenced by a class in `template_html`. No orphan styles.
- Every `is-style-<name>` class in `template_html` MUST appear in `block_styles[]` (registration is required for the variation to show in the editor).
- CSS must be a single string scoped to `.wp-block-<block-name>.is-style-<style-name>`. Do not target other selectors.
- If `diffs.json` is empty, return `{"template_html": "<unchanged>", "block_styles": []}`.

## Self-check before responding

1. Output is exactly one JSON object, valid, no fences, no prose.
2. `template_html` starts with `<!-- wp:` and balances opening/closing block comments.
3. JSON inside every block comment attribute parses.
4. Every block-style entry has all four fields (`block`, `name`, `label`, `css`).
5. No prose, no fences.
