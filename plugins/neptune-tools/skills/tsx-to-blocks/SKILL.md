---
name: tsx-to-blocks
description: Use when converting a Figma-generated React + Tailwind component (code.tsx) into Gutenberg block markup for a WordPress block theme template or template part. Outputs raw block HTML suitable for templates/<file>.html or parts/<file>.html.
---

# TSX → Gutenberg block markup

You convert a single React + Tailwind component (the output of Figma's code generator) into Gutenberg block markup for a WordPress block theme.

## Inputs the user will give you

- `code.tsx` — the React + Tailwind component to convert. Treat this as the source of truth for layout, hierarchy, and content. It is typically a full page (header + main content + footer).
- A scope instruction telling you whether to convert the HEADER region only, the FOOTER region only, the PAGE content (everything between the header and footer), or — for templates that embed `wp:post-content` — the WRAPPER chrome only or the POST-CONTENT body only. Honor it strictly. If you are building a page, include header and footer template parts as separate blocks, e.g. `<!-- wp:template-part {"slug":"header"} /-->` and `<!-- wp:template-part {"slug":"footer"} /-->`.
- Optionally `theme.json` — the active theme's settings. When present, ALWAYS use its preset slugs in preference to inlined raw values.
- Optionally `variables.json` — the flat token map originally scraped from Figma. Useful when a Tailwind class references a CSS variable that you need to resolve back to a preset.
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

Return ONLY raw Gutenberg block markup. No markdown fences. No preamble. No commentary. No explanation.

Start with `<!-- wp:` and end with the closing tag or comment of the outermost block. The output is dropped verbatim into `wp-content/themes/<theme>/templates/<file>.html` or `parts/<file>.html`, so:

- Do NOT include `<html>`, `<head>`, or `<body>`.
- Do NOT include the React function signature, props types, imports, or any TS.
- Do NOT include the `const imgFoo = "http://localhost:3845/..."` declarations.

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

When no preset matches, fall back to a raw `style` attribute, but only if the value is materially presentational. Drop noise Tailwind utilities that are layout scaffolding without a Gutenberg-side analogue.

When a class uses a CSS variable like `var(--eureka/contrast-1,#21201c)`, resolve via `theme.json` if there's a matching preset; otherwise look up the resolved value in `variables.json` and use that hex/length directly.

## Hard rules

- Every opening block comment must have a matching closing comment (`<!-- wp:foo --> ... <!-- /wp:foo -->`).
- JSON in block comment attributes must be valid: no trailing commas, no comments, double-quoted keys.
- Strip Figma's `data-node-id`, `data-name`, `data-neptune-annotations`, and `data-development-annotations` attributes from the output — they have no value in WordPress. Both annotation kinds still inform the conversion (semantic block selection / designer intent); they just don't appear in the emitted markup.
- Slugs are kebab-case, lowercase, alphanumeric + hyphens.
- For `wp:image` blocks: if the user supplies a `=== placeholder image ===` section with an attachment id and URL, use those values for every image block (`"id":<id>` in attrs, `<img src="<url>" class="wp-image-<id>">`). If no placeholder is supplied, leave `src=""` and omit the id. Never use Figma's local asset URLs (`http://localhost:3845/...`) and never invent file paths.
- Never wrap the response in markdown code fences.

## Self-check before responding

1. The first non-whitespace characters are `<!-- wp:`.
2. Every `<!-- wp:foo ... -->` has a matching `<!-- /wp:foo -->`.
3. JSON inside every block comment attribute parses.
4. No `function`, `import`, `const imgFoo`, or TypeScript syntax remains.
5. No prose, no fences.
