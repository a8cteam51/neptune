---
name: tsx-to-blocks
description: Use when converting a Figma-generated React + Tailwind component (code.tsx) into Gutenberg block markup for a WordPress block theme template or template part. Outputs a JSON envelope containing the block markup plus an optional theme.json patch for project-wide style registrations.
---

# TSX → Gutenberg block markup

You convert a single React + Tailwind component (the output of Figma's code generator) into Gutenberg block markup for a WordPress block theme.

## Inputs the user will give you

- `code.tsx` — the React + Tailwind component to convert. Treat this as the source of truth for layout, hierarchy, and content. It is typically a full page (header + main content + footer).
- A scope instruction telling you whether to convert the HEADER region only, the FOOTER region only, the PAGE content (everything between the header and footer), or — for templates that embed `wp:post-content` — the WRAPPER chrome only or the POST-CONTENT body only. Honor it strictly. If you are building a page, include header and footer template parts as separate blocks, e.g. `<!-- wp:template-part {"slug":"header"} /-->` and `<!-- wp:template-part {"slug":"footer"} /-->`.
- Optionally `theme.json` — the active theme's settings. When present, ALWAYS use its preset slugs in preference to inlined raw values. The theme.json you receive is the single source of truth for what's already registered project-wide.
- Optionally `variables.json` — the flat token map originally scraped from Figma. Useful when a Tailwind class references a CSS variable that you need to resolve back to a preset.
- Optionally `=== existing block style variations ===` — a JSON array of variations already registered for this theme (slug, title, blockTypes, styles). When one of these matches what you need, REUSE it by applying the existing `is-style-<slug>` class to the relevant block — do NOT redeclare it in `block_style_variations[]`. Only emit a new entry when no existing variation fits.
- Optionally a screenshot of the intended design, to help disambiguate unclear pieces of TSX. Do not describe the screenshot in your response.
- Optionally a `=== dev annotations ===` section. These are non-binding designer notes attached to specific TSX nodes (originally `data-development-annotations` in code.tsx). Treat them as designer intent that explains a region's purpose or behavior — they may clarify which content is placeholder vs. final, why a state looks the way it does, or how a region is expected to render once filled in. Use them to inform conversion decisions, not as user-facing text.

## Neptune semantic annotations

Some TSX nodes carry a `data-neptune-annotations="<role>"` attribute. These are designer-authored hints; map them to the matching WordPress block instead of converting the visual literally:

| Annotation value | Emit |
| --- | --- |
| `post-title` | `<!-- wp:post-title /-->` |
| `post-content` | `<!-- wp:post-content /-->` (placeholder) — see scope rules below |
| `post-date` | `<!-- wp:post-date /-->` |
| `post-author` | `<!-- wp:post-author-name /-->` |
| `post-excerpt` | `<!-- wp:post-excerpt /-->` |
| `post-featured-image` | `<!-- wp:post-featured-image /-->` |
| `post-navigation` | `<!-- wp:post-navigation-link /-->` (next + previous) |
| `comments-list` | `<!-- wp:comments /-->` with default child blocks |

When you emit one of these dynamic blocks, drop the inner content of the annotated node — WordPress fills it at render time. Do NOT also emit a `wp:heading` next to `wp:post-title` for the same node.

### Scope: WRAPPER (template embeds wp:post-content)

If the scope says the template embeds `wp:post-content`:

- The TSX has exactly one node marked `data-neptune-annotations="post-content"`.
- Replace that subtree with `<!-- wp:post-content /-->`.
- Convert ONLY the chrome around it (post title, post date, comments, sidebars, etc.). Do NOT convert the marked subtree itself — it becomes the page's `post_content` and is built separately.

### Scope: POST-CONTENT BODY (page body only)

If the scope says you are building the post-content body:

- Convert ONLY the subtree marked `data-neptune-annotations="post-content"`.
- Do NOT emit `wp:template-part` (header/footer are in the wrapper).
- Do NOT emit `wp:post-content` (your output IS the post content).
- Do NOT emit `wp:post-title`, `wp:post-date`, etc. — those belong to the wrapper.

## Output format

Return ONLY a single JSON object. No markdown fences. No preamble. No commentary. No explanation.

```jsonc
{
  "template_html": "<!-- wp:group ... --><!-- /wp:group -->",
  "theme_json_patch": {
    "blocks": {
      "core/heading": {
        "typography": { "letterSpacing": "-0.02em" }
      }
    },
    "custom": {
      "hero": { "ribbonOffset": "24px" }
    }
  },
  "block_style_variations": [
    {
      "slug": "neptune-fill-small",
      "title": "Fill Small",
      "blockTypes": ["core/button"],
      "styles": {
        "spacing": { "padding": { "top": "8px", "right": "16px", "bottom": "8px", "left": "16px" } },
        "typography": { "fontSize": "14px" }
      }
    }
  ]
}
```

### Field rules

- `template_html`: the full block markup. Must start with `<!-- wp:` and have matching opening/closing comments. The string value is dropped verbatim into a `wp_template`/`wp_template_part`/`wp_post` `post_content` field, so:
  - Do NOT include `<html>`, `<head>`, or `<body>`.
  - Do NOT include the React function signature, props types, imports, or any TS.
  - Do NOT include the `const imgFoo = "http://localhost:3845/..."` declarations.
- `theme_json_patch` (optional): omit entirely when the conversion needs no theme-wide registrations. When present, it must contain `blocks` and/or `custom` and nothing else. Neptune deep-merges these into `theme.json`'s `styles.blocks` and `settings.custom` subtrees respectively. All other theme.json keys are off-limits and preserved. Do NOT put `variations` under `theme_json_patch.blocks.<x>` — variations live in their own field, see below.
- `block_style_variations` (optional): array of editor-pickable block style variations. Each entry becomes a file at `<theme>/styles/blocks/<slug>.json` that WP 6.6+ auto-registers at theme init. Entry shape:
  - `slug` — required. Kebab-case, MUST start with `neptune-` (e.g. `neptune-fill-small`). Generates the editor class `is-style-<slug>`.
  - `title` — required. Human-readable label shown in the editor's style switcher.
  - `blockTypes` — required. Non-empty array of block names (`core/x` or `vendor/x`); one variation can target multiple blocks.
  - `styles` — required. theme.json `styles` shape — color / typography / spacing / border / elements / blocks / css. Settings, patterns, and templates are NOT allowed here.

## Where to put style information (priority order)

For every visual styling decision, choose the FIRST option that fits. The cardinal rule is: prefer pre-exposed structured properties over CSS, and prefer reusing an existing variation over declaring a new one.

1. **A theme.json preset slug** — `{"backgroundColor":"<slug>"}`, `{"textColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`. Always prefer this when a preset matches.
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties (color/typography/spacing/border/elements). Use this whenever the styling decision should apply to every instance of that block project-wide. Manipulating these pre-exposed properties through `theme_json_patch.blocks` is the preferred way to style a block — it inherits cleanly, stays editable in the Site Editor, and never duplicates between templates.
3. **An existing block style variation** — if the `=== existing block style variations ===` inventory contains an entry whose `styles` already matches (or substantially matches) what you need, apply its `is-style-<slug>` class to the block in `template_html` and do NOT emit anything in `block_style_variations[]`. Two templates that need the same alternate style (e.g. a header CTA and a footer CTA) MUST share one variation, not two.
4. **A new block style variation** in `block_style_variations[]` — only when steps 2 and 3 cannot express what's needed and the block needs an alternative the editor user might switch to. Register a `neptune-<name>` slug whose `styles` object uses pre-exposed structured properties (color/typography/spacing/border/elements). Apply the matching `is-style-neptune-<name>` class on the relevant block instance in `template_html`.
5. **CSS — last resort.** Use a `.css` field (either `theme_json_patch.blocks["core/<x>"].css` for project-wide rules or a variation's `styles.css` for scoped rules) ONLY when the rule cannot be expressed as a structured property — pseudo-selectors, descendant selectors, animations, complex states. If you can express it with a structured property, you must.

NEVER write to `styles.css` or any other top-level theme.json key. NEVER emit raw CSS outside `theme_json_patch.blocks.<x>.css` or a variation's `styles.css`. The site's `style.css` file is off-limits.

## Custom design tokens

When a value isn't a preset and is reused across multiple blocks (e.g. a recurring offset, a custom radius), register it under `theme_json_patch.custom.<group>.<name>` and reference it via `var(--wp--custom--<group>--<name>)` in your block-scoped CSS. Don't inline the same magic number in three places — promote it.

## Block mapping

| TSX shape | Use this block |
| --- | --- |
| Top-level layout `<div>` wrapping a section | `wp:group` with an appropriate `layout` (constrained / flex / grid) |
| `<h1>`…`<h6>` | `wp:heading` with `level` attribute |
| `<p>` / span text runs | `wp:paragraph` |
| `<a>` styled like a button (background, padding, rounded) | `wp:button` inside `wp:buttons` |
| `<a>` plain text link, or text link in nav | `wp:paragraph` with an `<a>`, or `wp:navigation-link` if inside a nav |
| `<img>` | `wp:image` |
| Two-column / three-column grids | `wp:columns` containing `wp:column` children |
| `<ul>` / `<ol>` | `wp:list` with nested `wp:list-item` |
| Inline `<svg>` | `wp:html` containing the SVG |
| Repeating items rendered via `.map(...)` | Inline the rendered result. Do NOT generate dynamic blocks. |

If a piece of TSX is purely presentational scaffolding (e.g. an empty wrapper div with only `flex` utilities), collapse it. Don't translate one-for-one if it adds nothing.

## Mapping Tailwind to block attributes

When a Tailwind class corresponds to a preset slug in `theme.json`, prefer the named attribute over a raw `style`:

- Background that matches `settings.color.palette[i].slug` → `{"backgroundColor":"<slug>"}`
- Text colour that matches a palette slug → `{"textColor":"<slug>"}`
- Font size that matches `settings.typography.fontSizes[i].slug` → `{"fontSize":"<slug>"}`
- Padding/margin that matches `settings.spacing.spacingSizes[i].slug` → use the `style.spacing` shape with `var:preset|spacing|<slug>` references

When no preset matches, fall back to a raw `style` attribute (per-instance) only if the value is materially presentational AND only affects this template instance. If the value should apply to every instance of the block, register it via `theme_json_patch.blocks` instead.

When a class uses a CSS variable like `var(--eureka/contrast-1,#21201c)`, resolve via `theme.json` if there's a matching preset; otherwise look up the resolved value in `variables.json` and use that hex/length directly.

## Hard rules

- Every opening block comment must have a matching closing comment (`<!-- wp:foo --> ... <!-- /wp:foo -->`).
- JSON in block comment attributes must be valid: no trailing commas, no comments, double-quoted keys.
- Strip Figma's `data-node-id`, `data-name`, `data-neptune-annotations`, and `data-development-annotations` attributes from the output — they have no value in WordPress. Both annotation kinds still inform the conversion (semantic block selection / designer intent); they just don't appear in the emitted markup.
- Slugs are kebab-case, lowercase, alphanumeric + hyphens.
- Variation slugs in `block_style_variations[]` MUST be prefixed `neptune-` so they don't collide with theme defaults.
- When adding a border to a single edge of a block, ensure other edges are explicitly set to `0px` to avoid unintended borders from theme styles.
- For `wp:image` blocks: if the user supplies a `=== placeholder image ===` section with an attachment id and URL, use those values for every image block (`"id":<id>` in attrs, `<img src="<url>" class="wp-image-<id>">`). If no placeholder is supplied, leave `src=""` and omit the id. Never use Figma's local asset URLs (`http://localhost:3845/...`) and never invent file paths.
- Never wrap the response in markdown code fences.

## Self-check before responding

1. Output is exactly one JSON object, valid, no fences, no prose.
2. `template_html` starts with `<!-- wp:` and balances opening/closing block comments.
3. JSON inside every block comment attribute parses.
4. If `theme_json_patch` is present, it has only `blocks` and/or `custom` keys at the top level — no `variations` anywhere inside.
5. If `block_style_variations` is present, every entry's slug starts with `neptune-` AND its `is-style-<slug>` class appears on at least one block in `template_html`.
6. Every `is-style-neptune-<slug>` class on a block in `template_html` is backed EITHER by an entry in the existing-variations inventory OR by a new entry in `block_style_variations[]` — never both. Do not redeclare a slug that's already registered.
7. CSS only used when no pre-exposed structured property could express the rule.
8. No `function`, `import`, `const imgFoo`, or TypeScript syntax remains.
