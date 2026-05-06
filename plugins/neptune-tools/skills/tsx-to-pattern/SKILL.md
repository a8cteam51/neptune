---
name: tsx-to-pattern
description: Use when converting a single Figma-pulled React + Tailwind pattern function (the contents of patterns/<Name>/code.tsx) into a WordPress block pattern. Outputs a JSON envelope containing the block markup plus pattern metadata (title, categories, keywords, viewport width) and an optional theme.json patch / block style variations.
---

# TSX → WordPress block pattern

You convert a single React + Tailwind component representing one reusable pattern (e.g. a hero, a feature row, a testimonial card) into Gutenberg block markup that WordPress can register as a block pattern.

Block patterns are PHP files at `<theme>/patterns/<slug>.php` that WordPress core auto-registers from a header comment block. Neptune writes the PHP wrapper for you — you only return the body markup and the metadata.

## Inputs the user gives you

- `pattern.tsx` — a single top-level function (and any inline helpers it depends on) extracted from a Figma `code.tsx`. The function name is the canonical name for the pattern. Treat the rendered output as the source of truth.
- Optionally `theme.json` — the active theme's settings. ALWAYS use its preset slugs in preference to inlined raw values. The `theme.json` you receive is the single source of truth for what's already registered project-wide.
- Optionally `variables.json` — the flat token map originally scraped from Figma. Useful when a Tailwind class references a CSS variable that you need to resolve back to a preset.
- Optionally `=== existing block style variations ===` — a JSON array of variations already registered for this theme (slug, title, blockTypes, styles). When one of these matches what you need, REUSE it by applying the existing `is-style-<slug>` class — do NOT redeclare it in `block_style_variations[]`.
- Optionally `=== placeholder image ===` — an attachment id and URL. Use those values for every `wp:image` block (`"id":<id>` in attrs, `<img src="<url>" class="wp-image-<id>">`).

## Output format

Return ONLY a single JSON object. No markdown fences. No preamble. No commentary.

```jsonc
{
  "title": "Hero callout",
  "description": "Big heading with subtext and a primary CTA.",
  "categories": ["featured", "hero"],
  "keywords": ["hero", "callout", "banner"],
  "block_types": [],
  "viewport_width": 1280,
  "inserter": true,
  "template_html": "<!-- wp:group ... --><!-- /wp:group -->",
  "theme_json_patch": {
    "blocks": {
      "core/heading": { "typography": { "letterSpacing": "-0.02em" } }
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
  ]
}
```

### Field rules

- `title` — required. Human-readable label shown in the inserter (e.g. "Hero callout"). Title-case is conventional.
- `description` — optional. One sentence describing the pattern's intent.
- `categories` — optional. Array of category slugs (lowercase kebab-case). Common WordPress core categories: `featured`, `posts`, `text`, `gallery`, `call-to-action`, `banner`, `header`, `footer`, `services`, `testimonials`, `contact`, `about`, `team`, `pricing`, `media`. Use these when a pattern fits cleanly; only invent a new category if none of the core ones apply.
- `keywords` — optional. Array of search terms users might type in the inserter.
- `block_types` — optional. Array of block names that this pattern is a "preferred replacement" for. For most patterns, leave this empty (`[]`). Common values: `core/post-content` for a default post layout, `core/template-part/header` for a header part replacement, `core/template-part/footer` for a footer.
- `viewport_width` — optional integer. Editor preview width in px. Default to `1280` for desktop-first patterns; use a smaller number (e.g. `400`) only when the pattern is genuinely narrow (sidebar widget, mobile-only).
- `inserter` — optional boolean. Default `true`. Set `false` only when the pattern should not appear in the user-facing inserter (e.g. it's a fragment used internally by other patterns).
- `template_html` — required. The full block markup. Must start with `<!-- wp:` and have matching opening/closing block comments. Drop verbatim into the PHP file body, so:
  - Do NOT include `<html>`, `<head>`, `<body>`.
  - Do NOT include the React function signature, props types, imports.
  - Do NOT include `const imgFoo = "http://localhost:3845/..."` declarations.
  - Do NOT emit `<?php` tags. Neptune adds the file header.
- `theme_json_patch` (optional) — same shape and rules as the `tsx-to-blocks` skill. Only `blocks` and/or `custom` at the top level. Don't put `variations` under `blocks.<x>`.
- `block_style_variations` (optional) — same shape and rules as `tsx-to-blocks`. `slug` MUST start with `neptune-`.

## Where to put style information (priority order)

For every visual styling decision, choose the FIRST option that fits. The cardinal rule is: prefer pre-exposed structured properties over CSS, and prefer reusing an existing variation over declaring a new one.

1. **A theme.json preset slug** — `{"backgroundColor":"<slug>"}`, `{"textColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`.
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties (color/typography/spacing/border/elements). Project-wide.
3. **An existing block style variation** — apply the matching `is-style-<slug>` class from the inventory; do NOT redeclare it.
4. **A new block style variation** in `block_style_variations[]`, again using structured properties.
5. **CSS — last resort.** Only when no structured property can express the rule.

NEVER write to `styles.css` or any other top-level theme.json key.

## Pattern-specific guidance

- **Patterns are reusable fragments, not full pages.** Don't emit `wp:template-part` (header/footer), `wp:post-title`, `wp:post-content`, or `wp:post-date` unless the source TSX explicitly uses those Neptune semantic annotations. The TSX you receive is already a fragment.
- **Wrap in a top-level container.** Patterns should have a single root `wp:group` (or equivalent layout block) so they slot cleanly into a parent layout. If the TSX has multiple sibling top-level elements, wrap them in a `wp:group`.
- **No dynamic blocks for repeating items.** If the source TSX maps over a list (`items.map(...)`), inline the rendered children rather than emitting query loops. Patterns are static markup the user can edit after insertion.
- **Self-contained styling.** A pattern that depends on a class defined elsewhere will look broken when inserted into a different template. Push project-wide styling to `theme_json_patch.blocks` so it applies everywhere.
- **Image handling.** Use the placeholder image (when provided) for every `wp:image`. Never use Figma's local asset URLs.

## Block mapping

Same as `tsx-to-blocks` — `wp:group` for layout containers, `wp:heading` for `<h1>`–`<h6>`, `wp:paragraph` for text runs, `wp:button` inside `wp:buttons` for `<a>` styled like a button, `wp:image` for `<img>`, `wp:columns`/`wp:column` for column layouts, `wp:list`/`wp:list-item` for `<ul>`/`<ol>`, `wp:html` for inline `<svg>`. Collapse purely presentational scaffolding.

## Hard rules

- Every opening block comment must have a matching closing comment.
- JSON in block comment attributes must be valid: no trailing commas, no comments, double-quoted keys.
- Strip Figma's `data-node-id`, `data-name`, `data-neptune-annotations`, and `data-development-annotations` attributes from the output.
- Slugs are kebab-case, lowercase, alphanumeric + hyphens.
- Variation slugs in `block_style_variations[]` MUST be prefixed `neptune-`.
- Never wrap the response in markdown code fences.

## Self-check before responding

1. Output is exactly one JSON object, valid, no fences, no prose.
2. `title` is present and human-readable.
3. `template_html` starts with `<!-- wp:` and balances opening/closing block comments.
4. JSON inside every block comment attribute parses.
5. If `theme_json_patch` is present, it has only `blocks` and/or `custom` at the top level — no `variations` anywhere inside.
6. If `block_style_variations` is present, every entry's slug starts with `neptune-` AND its `is-style-<slug>` class appears on at least one block in `template_html`.
7. Every `is-style-neptune-<slug>` class on a block is backed EITHER by an entry in the existing-variations inventory OR by a new entry in `block_style_variations[]` — never both.
8. CSS only used when no pre-exposed structured property could express the rule.
9. No `wp:template-part`, `wp:post-title`, `wp:post-content`, or `wp:post-date` unless the source TSX explicitly used those annotations.
10. No `function`, `import`, `const imgFoo`, `<?php`, or TypeScript syntax remains.
