---
name: tsx-to-pattern
description: Use when converting a single Figma-pulled React + Tailwind pattern function (the contents of patterns/<Name>/code.tsx) into a WordPress block pattern. The pattern is persisted as a PHP file under <theme>/patterns/<slug>.php; theme.json + block style variation registrations land via the pull-writer recipes.
---

# TSX → WordPress block pattern

Convert a single React + Tailwind component representing one reusable pattern (e.g. a hero, a feature row, a testimonial card) into Gutenberg block markup and persist it as a WordPress block pattern.

Block patterns are PHP files at `<theme>/patterns/<slug>.php`. WordPress core auto-registers them from a docblock comment at the top of the file. You write the file yourself — the host names the path in the task brief.

## Operating mode

You compute + persist + report. The host loads the **pull-writer** skill alongside this one; pull-writer ships the canonical recipes for theme.json patches (Recipe 6), block style variation files (Recipe 7), and cache flush (Recipe 5).

Available tools:

- `Read`, `Glob`, `Grep` — for inspecting the local theme + sibling patterns if you need to.
- `Edit`, `Write` — for the pattern PHP file, theme.json, and `styles/blocks/*.json`.
- `mcp__haydi__haydi_run_php` — for the cache flush (Recipe 5) after a theme.json or variation file change.
- NO `Task`, NO `Bash`.

Final response: a terse plaintext summary, one line per artifact. NO JSON envelope, NO markdown fences around markup.

## Inputs the user gives you

- The task brief names the pattern source's PascalCase function name, the kebab-case slug derived from it, the theme slug, and the absolute file path the pattern PHP must land at.
- `pattern.tsx` — a single top-level function (and any inline helpers it depends on) extracted from a Figma `code.tsx`. The function name is the canonical name for the pattern. Treat the rendered output as the source of truth.
- Optionally `theme.json` — the active theme's settings. ALWAYS prefer its preset slugs over inlined raw values.
- Optionally `variables.json` — the flat token map originally scraped from Figma. Useful when a Tailwind class references a CSS variable that you need to resolve back to a preset.
- Optionally `=== existing block style variations ===` — a JSON array of variations already registered for this theme. Reuse via `is-style-<slug>` over registering duplicates.
- Optionally `=== registered patterns ===` — a JSON array of OTHER patterns already registered (`name`, `slug`). When the source TSX invokes a function whose PascalCase name matches an entry, emit `<!-- wp:pattern {"slug":"<slug>"} /-->` for that JSX element instead of inlining the function body.

## Persistence flow

1. Decide on the pattern's metadata: `title` (human-readable, title-case), optional `description` (one sentence), optional `categories` (lowercase kebab-case slugs — common WP core categories: `featured`, `posts`, `text`, `gallery`, `call-to-action`, `banner`, `header`, `footer`, `services`, `testimonials`, `contact`, `about`, `team`, `pricing`, `media`), optional `keywords` (search terms), optional `block_types` (array of block names this pattern is a preferred replacement for — usually empty, common entries: `core/post-content`, `core/template-part/header`, `core/template-part/footer`), `viewport_width` integer (default 1280 unless genuinely narrow), `inserter` boolean (default true; set false only for fragments used internally by other patterns).
2. Compute the block markup body per the rules in the "Block mapping" + "Where to put style information" sections below.
3. **Write the pattern PHP file** with the `Write` tool to the path the host names in the task brief. File shape:

```php
<?php
/**
 * Title: <title>
 * Slug: <themeSlug>/<slug>
 * Categories: <category1>, <category2>
 * Keywords: <keyword1>, <keyword2>
 * Block Types: <block1>, <block2>
 * Viewport Width: <number>
 * Inserter: no
 * Description: <one-line description with whitespace collapsed>
 */
?>
<block markup>
```

Notes on the file format:

- The opening `<?php` / `?>` wrapping the docblock IS required — WP parses the docblock during boot.
- Each header line is `<Field>: <value>` inside the `/** */` block; one per line, with a leading ` * `.
- Order doesn't matter, but emit Title and Slug first; both are required.
- Omit `Categories`, `Keywords`, `Block Types`, `Viewport Width`, `Description` headers entirely when their value is empty/absent.
- Omit the `Inserter` header when `inserter` is true (the default); emit `Inserter: no` only when explicitly disabling.
- The block markup follows the closing `?>` directly with a leading newline. End the file with a single trailing newline.

4. **Apply theme.json patches** if the pattern legitimately requires extensions to `styles.blocks` or `settings.custom` (pull-writer Recipe 6).
5. **Register block style variations** if the pattern requires new editor-pickable variations (pull-writer Recipe 7). Reuse existing entries from the inventory first.
6. **Flush the cache** ONCE at the end via pull-writer Recipe 5 — only if Recipe 6 or 7 ran.
7. Emit terse summary lines:

```
wrote <theme path>/patterns/<slug>.php (<bytes> bytes)
edited <theme path>/theme.json (extended styles.blocks.core/heading)
wrote <theme path>/styles/blocks/neptune-callout-dark.json
flushed theme.json cache
```

## Where to put style information

Throughout this skill the names `theme_json_patch.blocks["core/<x>"]` and `block_style_variations[]` appear as mental shorthand for two on-disk destinations:

| Mental shorthand | Actual destination | Recipe |
|---|---|---|
| `theme_json_patch.blocks["core/<x>"]` | `theme.json`'s `styles.blocks["core/<x>"]` subtree | Recipe 6 |
| `theme_json_patch.custom` | `theme.json`'s `settings.custom` subtree | Recipe 6 |
| `block_style_variations[]` entry | one file at `styles/blocks/<slug>.json` | Recipe 7 |

Raw inline `style="..."` HTML attributes on the rendered HTML inside block markup are FORBIDDEN — they break Gutenberg's block validation. Promote every value to a theme.json patch (Recipe 6) or a registered variation (Recipe 7).

### Structured properties to check before reaching for `css`

Walk this list before deciding a value needs `css`:

- `spacing.padding`, `spacing.margin` — top/right/bottom/left, with preset refs (`var:preset|spacing|<slug>`) or raw lengths.
- `spacing.blockGap` — gap between child blocks. Use this in place of `gap:var(...)` inside a `css` field.
- `dimensions.minHeight` — supported on `core/group`, `core/cover`, etc.
- `dimensions.aspectRatio` — supported on `core/image`, `core/cover`, `core/post-featured-image`, `core/group`.
- `border.radius`, `border.color`, `border.width`, `border.style` — and per-side variants.
- `shadow` — preset slug or raw shadow value.
- `outline.color`, `outline.style`, `outline.width`, `outline.offset`.
- `filter.duotone` — preset slug.
- `typography.fontFamily/Size/Weight/Style/LetterSpacing/LineHeight/TextDecoration/TextTransform/TextColumns/WritingMode`.
- `color.background`, `color.text`, `color.gradient`.

What legitimately requires `css` and has no structured equivalent: `display`, `flex-direction`, `align-items`, `justify-content` _as variation styling_ (see "Layout attribute" below for the instance path), `box-sizing`, child-element selectors (`& img`, `& .wp-block-button__link`), `:hover`/`:focus` states, `@media` breakpoints.

### Layout attribute on block instances

`wp:group` (and `wp:columns`, `wp:cover`) takes a `layout` block ATTRIBUTE that selects the container type and exposes structured controls:

- `layout:{"type":"flex","orientation":"horizontal"|"vertical","justifyContent":...,"flexWrap":...,"verticalAlignment":...}`
- `layout:{"type":"grid","columnCount":N}` — fixed N-column grid. Or `{"type":"grid","minimumColumnWidth":"240px"}` for an auto-fit grid.
- `layout:{"type":"constrained"}` — centered content. Pick width via `align`: omit for `contentSize`, `align:"wide"` for `wideSize`, `align:"full"` for edge-to-edge. **Do NOT pin `contentSize`/`wideSize` on the pattern's blocks** — patterns are portable; pinned widths break when the host theme's `theme.json.settings.layout` differs.
- Pair with `style:{"spacing":{"blockGap":"var:preset|spacing|<slug>"}}` for inter-child gap.

### Priority order

For every styling decision, work top-down and stop at the first option that fits.

1. **A theme.json preset slug** — `{"backgroundColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`. Always prefer this when a preset matches.
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties. Persisted via Recipe 6.
3. **An existing block style variation** — apply the matching `is-style-<slug>` class; do NOT redeclare.
4. **A new block style variation** — register one (Recipe 7) when a recurring styled instance warrants it.
5. **The `layout` attribute on the block instance** — for flex / grid / constrained containers. Do NOT emulate via custom `className` + CSS.
6. **CSS — last resort.** Only when no structured property can express the rule and it isn't a `layout` choice. Prefer `&{...}` and block-internal child selectors (`& img`).

NEVER write to `styles.css` or any other top-level theme.json key.

## Pattern-specific guidance

- **Patterns are reusable fragments, not full pages.** Don't emit `wp:template-part` (header/footer), `wp:post-title`, `wp:post-content`, or `wp:post-date` unless the source TSX explicitly uses those Neptune semantic annotations.
- **Wrap in a top-level container.** Patterns should have a single root `wp:group` (or equivalent layout block) so they slot cleanly into a parent layout. If the TSX has multiple sibling top-level elements, wrap them in a `wp:group`.
- **No dynamic blocks for repeating items.** If the source TSX maps over a list (`items.map(...)`), inline the rendered children rather than emitting query loops. Patterns are static markup the user can edit after insertion.
- **Self-contained styling.** A pattern that depends on a class defined elsewhere will look broken when inserted into a different template. Push project-wide styling to theme.json's `styles.blocks` (Recipe 6) so it applies everywhere.

## Block mapping

Same as `tsx-to-blocks`:

- `wp:group` for layout containers (with the `layout` attribute)
- `wp:heading` for `<h1>`–`<h6>`
- `wp:paragraph` for text runs
- `wp:button` inside `wp:buttons` for `<a>` styled like a button
- `wp:image` for `<img>` with mapped const sources
- `wp:columns`/`wp:column` for column layouts
- `wp:list`/`wp:list-item` for `<ul>`/`<ol>`
- `wp:html` for inline `<svg>` (last resort)

Collapse purely presentational scaffolding.

When the pattern is a contact / signup / lead-capture form, use the Jetpack form blocks: a single `jetpack/contact-form` parent wrapping `jetpack/field-*` blocks and a `jetpack/button` (NOT `core/button`) submit. Field width via the `width` attribute on each field block (25 / 50 / 75 / 100); never wrap fields in `wp:columns` to fake a side-by-side layout. Read `label`, `required`, `placeholder`, `defaultValue`, and `options` from the JSX.

## Hard rules

- Every opening block comment must have a matching closing comment.
- JSON in block comment attributes must be valid: no trailing commas, no comments, double-quoted keys.
- NEVER emit a raw HTML `style="..."` attribute (including `style=""`) on the rendered HTML elements inside block markup. Do NOT set instance-level `"style":{...}` JSON block attributes either, except for the canonical `"style":{"spacing":{"blockGap":"var:preset|spacing|<slug>"}}` on layout containers.
- Strip Figma's `data-node-id`, `data-name`, `data-neptune-annotations`, and `data-development-annotations` attributes from the output.
- Slugs are kebab-case, lowercase, alphanumeric + hyphens.
- Variation slugs MUST be prefixed `neptune-`.
- Do NOT invent project-specific `className` values whose only purpose is to give a CSS rule a selector.
- Do NOT pin `contentSize` or `wideSize` on the pattern's blocks. Patterns are portable.

## Self-check before responding

1. Pattern PHP written via Write to the brief's path. Docblock has `Title` + `Slug` headers at minimum. Block markup body follows the `?>` closer.
2. theme.json edits (if any) via Recipe 6 — only `styles.blocks` and `settings.custom` touched. No `variations` field anywhere inside `styles.blocks["core/<x>"]`.
3. Variation files (if any) via Recipe 7. Every variation file slug is `neptune-` prefixed AND its `is-style-<slug>` class appears on at least one block in the pattern markup.
4. Cache flush (Recipe 5) ran ONCE iff Recipe 6 or 7 ran.
5. Block markup starts with `<!-- wp:` and balances opening/closing block comments. JSON inside every block comment attribute parses.
6. Zero raw HTML `style="..."` attributes (including empty `style=""`) and zero instance-level `"style":{...}` block attributes — except the canonical `style.spacing.blockGap` on layout containers.
7. No block declares its own `contentSize` or `wideSize` under `layout`. Width is `align:"wide"` / `align:"full"` / no align.
8. No `wp:template-part`, `wp:post-title`, `wp:post-content`, or `wp:post-date` unless the source TSX explicitly used those annotations.
9. No `function`, `import`, `const imgFoo`, or TypeScript syntax remains in the block markup body. The PHP file's `<?php /** … */ ?>` wrapper is exactly the four lines shown above.
