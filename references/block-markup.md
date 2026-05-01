# Block markup contract

Authoritative list of the core Gutenberg blocks Neptune is allowed to emit and the syntax for each. Every `templates/*.html`, `parts/*.html`, and any block markup written into a WP_Post `post_content` via `/build-content` must use only the blocks documented here.

This file is the single source of truth referenced by `commands/build-template.md`, `commands/build-content.md`, and the refine references. If you find yourself reaching for a block not listed here, stop and open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.

## Validation contract

- **Per-chunk validation is mandatory.** Every block-markup string this plugin produces is validated through `mcp__wordpress-studio__validate_blocks` before being written to disk or pushed to a post via WP CLI. The Studio MCP runs validation against the actual WordPress install the markup will render in, so the validation context matches the rendered context.
- **Cross-file consistency is your responsibility.** `validate_blocks` is per-chunk — slug references, `templateParts` registration, preset resolution, and required-block presence are not checked for you. Verify them against `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` whenever a step writes theme files.
- **Never bypass validation.** Falling back to `wp:html`, embedding raw HTML, or shipping markup that the validator rejected is forbidden under the building guardrails.

## Block-comment syntax

Gutenberg blocks are HTML comments wrapping HTML.

```html
<!-- wp:block-name {"attribute":"value"} -->
<tag class="wp-block-block-name">content</tag>
<!-- /wp:block-name -->
```

Rules:

- The block name in opening and closing comments **must match exactly**.
- Attributes are JSON: strings double-quoted, booleans / numbers unquoted.
- A block with no attributes omits the JSON payload: `<!-- wp:paragraph -->`.
- Self-closing blocks (no inner content) use `/`: `<!-- wp:site-title /-->`.
- The HTML inside must match what core's `save()` would render. The class list on the rendered tag must include `wp-block-<name>` plus every alignment / preset class implied by attributes (`alignfull`, `has-base-background-color`, `has-background`, `has-text-color`, `has-<size>-font-size`, etc.).

## Preset reference syntax

Theme.json values reach block markup in two forms. Both must resolve to a slug in `theme.json` (see `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md`).

| Where | Form | Example |
| --- | --- | --- |
| Block attribute | slug only | `"textColor":"primary"` |
| Inline `style` | full var path | `style="color:var(--wp--preset--color--primary)"` |
| Spacing inside `style` | `var:preset|...` shorthand | `"style":{"spacing":{"padding":{"top":"var:preset|spacing|40"}}}` |

Always prefer the slug attribute form. Inline `style=` strings are a last resort and signal a missing token in `theme.json`.

## Allowed blocks

Order: structural → text → media → site / FSE-only → query.

### Structural

#### `core/group`

Wrapper for sections, rows, stacks, cards.

```html
<!-- wp:group {"align":"full","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}},"backgroundColor":"base","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-base-background-color has-background" style="padding-top:var(--wp--preset--spacing--60);padding-bottom:var(--wp--preset--spacing--60)">…</div>
<!-- /wp:group -->
```

`layout.type` is one of:
- `"constrained"` — children flow vertically, capped at `settings.layout.contentSize`; `align:wide`/`align:full` opt out.
- `"default"` — flow without constraint.
- `"flex"` — flexbox; configure `orientation`, `justifyContent`, `flexWrap`, `verticalAlignment`.

`align` is `"wide"` or `"full"` only — omit for content-width.

`tagName` overrides the rendered wrapper element. Use it for landmark roles (`<header>`, `<main>`, `<footer>`, `<nav>`, `<aside>`).

#### `core/columns` and `core/column`

Multi-column row.

```html
<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide">
  <!-- wp:column {"width":"33.33%"} -->
  <div class="wp-block-column" style="flex-basis:33.33%">…</div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->
```

Reserve `core/columns` for genuine multi-column page sections. A flex row of two buttons or icon+text is a `core/group` with `layout:flex`, not columns.

#### `core/buttons` and `core/button`

```html
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
  <!-- wp:button {"backgroundColor":"primary","textColor":"base","style":{"border":{"radius":"4px"}}} -->
  <div class="wp-block-button"><a class="wp-block-button__link has-base-color has-primary-background-color has-text-color has-background has-link-color wp-element-button" style="border-radius:4px" href="/about">About</a></div>
  <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
```

Buttons always live inside `core/buttons`. Standalone `core/button` is invalid.

#### `core/separator`

Horizontal divider. Use this for thin horizontal `imgVector*` shape primitives (see `${CLAUDE_PLUGIN_ROOT}/references/reading-design-context.md` triage).

```html
<!-- wp:separator {"backgroundColor":"contrast"} -->
<hr class="wp-block-separator has-text-color has-contrast-color has-alpha-channel-opacity has-contrast-background-color has-background"/>
<!-- /wp:separator -->
```

#### `core/spacer`

Explicit vertical gap. Prefer `blockGap` on the parent group; reach for `spacer` only when the design genuinely needs an empty vertical band that's not expressible via padding.

```html
<!-- wp:spacer {"height":"var:preset|spacing|50"} -->
<div style="height:var(--wp--preset--spacing--50)" aria-hidden="true" class="wp-block-spacer"></div>
<!-- /wp:spacer -->
```

### Text

#### `core/heading`

```html
<!-- wp:heading {"level":2,"textAlign":"center","fontSize":"x-large"} -->
<h2 class="wp-block-heading has-text-align-center has-x-large-font-size">Heading</h2>
<!-- /wp:heading -->
```

`level` matches the visual hierarchy in Figma (1 for the page H1, 2 for section titles, etc.). The accessibility guardrails in `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md` apply: exactly one H1 per page, no skipped levels.

#### `core/paragraph`

```html
<!-- wp:paragraph {"fontSize":"medium"} -->
<p class="has-medium-font-size">Body copy.</p>
<!-- /wp:paragraph -->
```

Eyebrow / kicker text (small uppercase above a heading) is a paragraph with `style.typography.textTransform = "uppercase"` and the smallest scale step.

#### `core/list` and `core/list-item`

```html
<!-- wp:list -->
<ul class="wp-block-list">
  <!-- wp:list-item -->
  <li>First</li>
  <!-- /wp:list-item -->
  <!-- wp:list-item -->
  <li>Second</li>
  <!-- /wp:list-item -->
</ul>
<!-- /wp:list -->
```

Use `{"ordered":true}` on `core/list` to render `<ol>`.

#### `core/quote`

```html
<!-- wp:quote -->
<blockquote class="wp-block-quote">
  <!-- wp:paragraph -->
  <p>Quoted text.</p>
  <!-- /wp:paragraph -->
  <cite>Attribution</cite>
</blockquote>
<!-- /wp:quote -->
```

### Media

#### `core/image`

```html
<!-- wp:image {"id":<ATTACHMENT_ID>,"sizeSlug":"full","linkDestination":"none"} -->
<figure class="wp-block-image size-full"><img src="<ATTACHMENT_URL>" alt="<alt-text>" class="wp-image-<ATTACHMENT_ID>"/></figure>
<!-- /wp:image -->
```

The `id` must match a real WordPress attachment imported via `wp media import`. See the asset workflow in `${CLAUDE_PLUGIN_ROOT}/references/reading-design-context.md` for the import procedure and the shape-primitive vs real-content triage.

Above-the-fold hero images add `loading="eager"` and `fetchpriority="high"`. Below-the-fold images add `loading="lazy"`.

Decorative images take `alt=""`. For genuine content images with no Figma-supplied alt, open a follow-up issue listing them.

#### `core/cover`

Image / video background with overlaid content.

```html
<!-- wp:cover {"url":"<ATTACHMENT_URL>","id":<ATTACHMENT_ID>,"dimRatio":40,"align":"full","layout":{"type":"constrained"}} -->
<div class="wp-block-cover alignfull">
  <span aria-hidden="true" class="wp-block-cover__background has-background-dim-40 has-background-dim"></span>
  <img class="wp-block-cover__image-background wp-image-<ATTACHMENT_ID>" alt="" src="<ATTACHMENT_URL>" data-object-fit="cover"/>
  <div class="wp-block-cover__inner-container">
    …overlaid blocks…
  </div>
</div>
<!-- /wp:cover -->
```

Use for any frame where text or buttons sit on top of an image. Don't compose it from a `core/group` with `core/image` as a sibling — `core/cover` is the canonical block for this.

### Site / FSE-only

#### `core/site-title`

```html
<!-- wp:site-title {"level":0} /-->
```

Use for text-only logos (wordmarks). `level:0` renders as `<p>`; `level:1`–`6` render as `<h1>`–`<h6>`. Don't render the brand name as a `core/heading` with hard-coded text — that breaks the FSE Site Settings flow.

#### `core/site-logo`

```html
<!-- wp:site-logo {"width":120} /-->
```

Use for image logos. The actual asset is set in WP Site Settings, not in the markup.

#### `core/navigation`

```html
<!-- wp:navigation {"layout":{"type":"flex","justifyContent":"right"}} /-->
```

Emit without a `ref` attribute. WordPress creates a default `wp_navigation` post the first time the theme is activated; the user populates it via the editor. Never hard-code menu items as `<a>` tags.

#### `core/template-part`

```html
<!-- wp:template-part {"slug":"header","tagName":"header"} /-->
```

`slug` must reference an existing file in `parts/<slug>.html`. The `tagName` lives on the call site, not on the part's own outer wrapper.

#### `core/post-content`

```html
<!-- wp:post-content {"layout":{"type":"constrained"}} /-->
```

The placeholder for the WP_Post body. Required in `single.html`, `singular.html`, `page.html`. The body content itself is filled by `/build-content` and stored in `post_content`, not in the template file.

#### `core/post-title`

```html
<!-- wp:post-title {"level":1} /-->
```

#### `core/post-date`, `core/post-author-name`, `core/post-featured-image`, `core/post-excerpt`

Self-closing FSE blocks for post metadata. Standard syntax — see core docs for the full attribute list.

### Query

#### `core/query`, `core/post-template`

```html
<!-- wp:query {"queryId":1,"query":{"perPage":10,"postType":"post"},"layout":{"type":"constrained"}} -->
<div class="wp-block-query">
  <!-- wp:post-template -->
    <!-- wp:post-title {"isLink":true,"level":2} /-->
    <!-- wp:post-excerpt /-->
    <!-- wp:post-date /-->
  <!-- /wp:post-template -->
  <!-- wp:query-pagination -->
    <!-- wp:query-pagination-previous /-->
    <!-- wp:query-pagination-numbers /-->
    <!-- wp:query-pagination-next /-->
  <!-- /wp:query-pagination -->
</div>
<!-- /wp:query -->
```

Required in `index.html` (when used as the blog landing), `archive.html`, `category.html`, `tag.html`, `search.html`. Forbidden in `404.html`.

## Spacing attributes

Margins, padding, and gap are set via `style.spacing` on the parent block:

```json
{"style":{"spacing":{
  "padding":{"top":"var:preset|spacing|40","bottom":"var:preset|spacing|40"},
  "margin":{"top":"0"},
  "blockGap":"var:preset|spacing|30"
}}}
```

`blockGap` controls space between child blocks (only meaningful with a `layout`). Put padding on the wrapper, not on every child.

## Things never to emit

- Custom blocks (`<!-- wp:my-theme/foo -->`).
- Third-party blocks not in this file.
- `<!-- wp:html -->`. See the building guardrails.
- React component imports / Tailwind classes — those are intermediate references from Figma, not output.
- `<style>` tags inside templates or parts.
- `<script>` tags.
- WordPress shortcodes inside template HTML.
- Inline event handlers.
- Hard-coded `<a>` lists in place of `core/navigation`.
- A `core/image` for the brand mark — use `core/site-logo` so users can update it in Site Settings.

## Walking a Figma node tree

Walk depth-first per `${CLAUDE_PLUGIN_ROOT}/references/reading-design-context.md`. For each node:

1. Identify the root frame's role (template wrapper / part / section).
2. Map the root to a container block (`group` or `cover`).
3. For each child:
   a. Determine its block from the rules above.
   b. If it's a container, recurse.
   c. If it's a leaf (text, image), emit the leaf block.
4. Apply spacing on parents, not on every child.
5. Validate: every preset reference resolves against `theme.json`; the chunk passes `mcp__wordpress-studio__validate_blocks`. Cross-file pieces (template-part slug references, `templateParts` registration, required blocks per template slug) are not covered by `validate_blocks` — verify them against `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md`.

## When a Figma element has no clean mapping

Stop and ask. Don't invent custom blocks. Don't reach for `core/html`. The acceptable resolutions are:

- Promote the missing concept to a `theme.json` token and re-emit.
- Approximate with the closest core block composition and note the gap in the run summary.
- File a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` and leave a placeholder paragraph.
