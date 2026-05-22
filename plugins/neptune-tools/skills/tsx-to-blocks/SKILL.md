---
name: tsx-to-blocks
description: Use when converting a Figma-generated React + Tailwind component (code.tsx) into Gutenberg block markup for a WordPress block theme template or template part. Outputs a JSON envelope containing the block markup plus an optional theme.json patch for project-wide style registrations.
---

# TSX → Gutenberg block markup

Convert a single React + Tailwind component (the output of Figma's code generator) into Gutenberg block markup for a WordPress block theme.

## Operating mode

This skill is a single-shot prompt → JSON transform. Do NOT call any tools — no Agent / Task subagent dispatch, no Read / Write / Edit / Bash, no MCP. Neptune validates and persists the JSON envelope itself. The only valid output is the JSON object described under "Output format".

## Inputs the user will give you

- `code.tsx` — the React + Tailwind component to convert. Treat this as the source of truth for layout, hierarchy, and content. It is typically a full page (header + main content + footer).
- A scope instruction telling you whether to convert the HEADER, FOOTER, PAGE, WRAPPER (template that embeds `wp:post-content`), or POST-CONTENT BODY region. Honor it strictly. See "Region-scope annotations" below for the exact rules each scope follows, including when to emit `wp:template-part` references vs. inline content vs. ignore a subtree.
- Optionally `theme.json` — the active theme's settings AND existing styles. Single source of truth for what's already registered project-wide. Read three subtrees deliberately:
  - `settings.color.palette` / `settings.typography.fontSizes` / `settings.spacing.spacingSizes` — preset slugs for `{"backgroundColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `var:preset|spacing|<slug>`, etc. ALWAYS prefer these to inlined raw values.
  - `styles.blocks["core/<x>"]` — what's already styled at the block level. Your `theme_json_patch.blocks["core/<x>"]` EXTENDS this subtree (Neptune deep-merges); it does not overwrite. Reading this lets you see what's already covered and what isn't.
  - `settings.blocks["core/<x>"]` — per-block setting overrides (which structured properties the editor exposes for that block). If a structured property isn't enabled here or in the global `settings.*`, the editor won't surface the control even after your patch lands.
- Optionally `variables.json` — the flat token map originally scraped from Figma. Useful when a Tailwind class references a CSS variable that you need to resolve back to a preset.
- Optionally `=== existing block style variations ===` — a JSON array of variations already registered for this theme (slug, title, blockTypes, styles). When one of these matches what you need, REUSE it by applying the existing `is-style-<slug>` class to the relevant block — do NOT redeclare it in `block_style_variations[]`. Only emit a new entry when no existing variation fits.
- Optionally `=== registered patterns ===` — a JSON array of block patterns already registered in the theme (`name`, `slug`). When code.tsx invokes a function whose PascalCase name exactly matches a `name` entry, emit `<!-- wp:pattern {"slug":"<slug>"} /-->` for that JSX element instead of inlining the function body. See "Registered patterns" below.
- Optionally a screenshot of the intended design, to help disambiguate unclear pieces of TSX. Do not describe the screenshot in your response.
- Optionally a `=== dev annotations ===` section. These are non-binding designer notes attached to specific TSX nodes (originally `data-development-annotations` in code.tsx). Treat them as designer intent that explains a region's purpose or behavior — they may clarify which content is placeholder vs. final, why a state looks the way it does, or how a region is expected to render once filled in. Use them to inform conversion decisions, not as user-facing text.
- Optionally a `=== media library mappings ===` section. It has up to two parts:
  - **Mapped entries** — `<constName> → id=<n>, url=<...>` lines. Each maps a `const imgFoo = "http://localhost:3845/..."` declaration in code.tsx to a real attachment already imported into the WordPress media library.
  - **Discarded entries** — `<constName>: <description>` lines (some tagged `[render failure]`). These are SVG references the triage step rejected as decoration (or that failed to rasterize) and that have NO media item. The description is a 1-sentence record of what the rendered image was — it is the primary signal for picking a structural replacement when you encounter the const in code.tsx. See "Handling SVG and unmapped image references" below.
  - Any const that appears in NEITHER list is also unmapped and is treated identically to a discarded entry, just without an explicit description.

## Scope vocabulary

Inline prompts dispatch by emitting a single `SCOPE: <TOKEN>` line that selects exactly one of the regions below. Read the matching subsection under "Per-scope rules" and apply it verbatim. Token names are STABLE — Neptune's prompt code references them, do not rename.

| Token               | Per-scope rules section    |
| ------------------- | -------------------------- |
| `PAGE`              | "Scope: PAGE"              |
| `HEADER`            | "Scope: HEADER"            |
| `FOOTER`            | "Scope: FOOTER"            |
| `WRAPPER`           | "Scope: WRAPPER"           |
| `POST-CONTENT-BODY` | "Scope: POST-CONTENT-BODY" |

## Neptune semantic annotations

Some TSX nodes carry a `data-neptune-annotations="<role>"` attribute. They fall into three distinct categories with different handling:

- **Block-mapping annotations** substitute the marked node 1:1 with a specific WordPress dynamic block, dropping its inner content.
- **Container-mapping annotations** substitute the marked node with a wrapper block whose CHILDREN come from converting the JSX node's children — the inner content is preserved (and itself gets converted), it is not dropped.
- **Region-scope annotations** mark a structural region (header, footer, page body) that the build pipeline routes to its own template artifact. They are never converted in-place — the active scope (set by the user's scope instruction) dictates whether each region becomes a placeholder, a `wp:template-part` reference, gets sliced out, or IS the only region you convert.

All three kinds of annotations are stripped from the emitted markup; only their effect on the conversion remains.

### Resolving annotation values

The values in the tables below are CANONICAL — the exact strings a precise designer would type — but Figma annotations are typed by humans, so values drift. Resolve every annotation by intent, not by literal string equality. Walk this order and stop at the first step that yields a match:

1. **Exact match** — the literal value appears in the canonical table for one of the three categories. Apply that mapping verbatim.
2. **Near-match (normalize, then re-check)** — apply these transforms to the value and re-test against the canonical tables:
   - lowercase
   - replace `_`, ` `, `:`, and camelCase boundaries with `-`
   - strip a leading `wp-`, `wp:`, or `core/` prefix
   - strip a leading or trailing `block`
   - try with and without a leading `post-` (so `featured-image`, `featuredImage`, `featured_image`, `wp:post-featured-image`, and `post-featured-image` all collapse to the canonical `post-featured-image`)
   
   If the normalized value is in a canonical table, apply that mapping.
3. **Semantic match for block-mapping (off-list dynamic blocks)** — when the value isn't in the canonical table even after normalization, but the design intent clearly maps to a WordPress core dynamic block, emit that block. Use this non-exhaustive guide for the common ones designers reach for:
   
   | Designer says (any near-variant)                 | Emit                                    |
   | ------------------------------------------------ | --------------------------------------- |
   | `site-logo`, `logo`, `brand`                     | `<!-- wp:site-logo /-->`                |
   | `site-title` (brand, not a post heading)         | `<!-- wp:site-title /-->`               |
   | `site-tagline`, `tagline`                        | `<!-- wp:site-tagline /-->`             |
   | `post-content`, `content-body` (as block-mapping, not region-scope — see below) | `<!-- wp:post-content /-->` |
   | `post-comments-count`, `comments-count`          | `<!-- wp:comments-count /-->`           |
   | `post-comments-form`, `comments-form`            | `<!-- wp:post-comments-form /-->`       |
   | `post-comments-link`, `comments-link`            | `<!-- wp:post-comments-link /-->`       |
   | `query-pagination`, `pagination`                 | `<!-- wp:query-pagination /-->` (with default children) |
   | `post-terms`, `categories`, `tags`               | `<!-- wp:post-terms {"term":"category"} /-->` (use `post_tag` for tags) |
   | `search`, `search-form`                          | `<!-- wp:search /-->`                   |
   | `loginout`, `login-out`, `login-link`            | `<!-- wp:loginout /-->`                 |
   | `archive-title`, `query-title`                   | `<!-- wp:query-title {"type":"archive"} /-->` |
   | `read-more`, `more-link`                         | `<!-- wp:read-more /-->`                |
   | `nav`, `navigation`, `menu`, `main-menu`         | `<!-- wp:navigation /-->`               |
   
   Pick the closest match by role. If you're 70%+ confident the designer meant a specific dynamic block, emit it; if you're guessing, fall through to step 4.
4. **Fallback** — if nothing canonical or semantic fits, treat the annotation as a designer's documentation label rather than a dispatch directive. Convert the JSX node by the standard rules (no dynamic-block substitution, no skipped subtree). Do not emit a comment or warning — the annotation is informational only at that point.

### Block-mapping annotations

Substitute the marked node with the matching WordPress block instead of converting the visual literally. Drop the inner content of the annotated node — WordPress fills it at render time.

Canonical values:

| Annotation value      | Emit                                                  |
| --------------------- | ----------------------------------------------------- |
| `post-title`          | `<!-- wp:post-title /-->`                             |
| `post-date`           | `<!-- wp:post-date /-->`                              |
| `post-author`         | `<!-- wp:post-author-name /-->`                       |
| `post-excerpt`        | `<!-- wp:post-excerpt /-->`                           |
| `post-featured-image` | `<!-- wp:post-featured-image /-->`                    |
| `post-navigation`     | `<!-- wp:post-navigation-link /-->` (next + previous) |
| `comments-list`       | `<!-- wp:comments /-->` with default child blocks     |

These are the canonical values; resolve near-matches and semantic equivalents per "Resolving annotation values" above. So a designer who writes `title`, `Post Title`, `post_title`, or `wp:post-title` on a heading element resolves to `wp:post-title` here; a designer who writes `featured-image` resolves to `wp:post-featured-image`.

Do NOT also emit a `wp:heading` (or other literal block) next to `wp:post-title` for the same node — the dynamic block replaces the literal entirely.

### Container-mapping annotations

Canonical values:

| Annotation value | Emit                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| `query-loop`     | `wp:query` wrapping a `wp:post-template` whose contents are the node's children |

Resolve near-matches per "Resolving annotation values" above — `queryLoop`, `query_loop`, `posts-loop`, `loop`, `query` all collapse to `query-loop`. There is currently only one container-mapping annotation; if a designer writes something that clearly means "this is a list of repeating posts pulled from the database" but doesn't match any canonical name (e.g. `posts-grid`, `latest-posts`, `cpt-list`), treat it as `query-loop`. If the intent is unclear (e.g. `card-grid` could be static cards OR a query), fall through to literal conversion — patterns of static repetition belong in the markup, not in `wp:query`.

#### `query-loop` → `wp:query` + `wp:post-template`

A `data-neptune-annotations="query-loop"` attribute marks a JSX node that visually represents a list / grid of posts pulled from a database query. Substitute the marked node with a `wp:query` block, place a `wp:post-template` inside it, and convert the marked node's children INTO the post-template.

**Block name:** the editor UI calls this the "Query Loop block" but its WordPress slug is `core/query` — emit `<!-- wp:query ... -->`. Do NOT emit `<!-- wp:query-loop -->`; that slug does not exist and the block parser will reject it. The annotation value (`query-loop`) is the designer's vocabulary, not the WP block name.

Shape:

```
<!-- wp:query {"queryId":<n>,"query":{"perPage":<n>,"postType":"post","inherit":false,...}} -->
<div class="wp-block-query">
	<!-- wp:post-template -->
		[the annotated node's children, converted by the standard rules]
	<!-- /wp:post-template -->
</div>
<!-- /wp:query -->
```

Conversion rules:

- The annotated node's children become the contents of `wp:post-template`. Convert them normally — block-mapping annotations (`post-title`, `post-date`, `post-featured-image`, `post-excerpt`, `post-author`, `post-navigation`) inside the loop produce the per-post dynamic blocks the template renders for each matching post.
- One iteration only. If the JSX duplicates the same card markup three times (Figma often shows a list by repeating the design), inline the FIRST iteration only; `wp:post-template` repeats it server-side per post. Same when the JSX uses `.map()` over a hard-coded array — convert the body of the map callback as the single iteration and discard the array.
- The wrapping `<div class="wp-block-query">` is required — the block's `save()` function emits it, and a missing wrapper fails block validation in the editor.
- The annotated node's own background, padding, border, layout, etc., translate onto the `wp:query` block (`style.color.background`, `style.spacing.padding`, `border`, `layout`) the same way they would on any wrapper block. Per-card visual styling translates onto `wp:post-template`.

Query attributes (read from JSX context where possible, otherwise use the defaults):

| Attribute         | Default          | Override when                                                                                                                              |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `queryId`         | `0`              | Multiple `query-loop` annotations on the same page need distinct ids; increment per occurrence.                                            |
| `query.postType`  | `"post"`         | Surrounding heading or annotated subtree clearly references a CPT ("Products", "Events", "Case studies") — use the matching CPT slug.      |
| `query.perPage`   | `10`             | The JSX shows N visible cards (e.g. a 3×2 grid → `6`). Use that count.                                                                     |
| `query.inherit`   | `false`          | Always `false` for explicit `query-loop` annotations. (`inherit:true` is for archive templates that reuse the URL's main query — that's a separate scope, not this annotation.) |
| `query.order`     | `"desc"`         | Visible "Oldest first" / sort UI says ascending — use `"asc"`.                                                                             |
| `query.orderBy`   | `"date"`         | UI clearly sorts by something else (title, menu_order). Otherwise keep `"date"`.                                                           |

Optional siblings of `wp:post-template` inside the wrapper `<div class="wp-block-query">`:

- `wp:query-pagination` (containing `wp:query-pagination-previous`, `wp:query-pagination-numbers`, `wp:query-pagination-next`) when the JSX shows pagination controls below the grid.
- `wp:query-no-results` for an empty-state message. If the JSX includes empty-state markup tied to the loop, convert it here. Otherwise emit a single `wp:paragraph` with a sensible default like "No posts found.".

If the annotated subtree contains a heading or intro paragraph that visibly belongs OUTSIDE the per-card iteration (e.g. "Latest articles" above the grid), keep that heading/paragraph as a sibling of the `wp:query` block, not inside `wp:post-template` — only the parts that repeat per post belong in the post-template.

### Region-scope annotations

These three values mark structural regions that live in their own template artifact. Each is built by a separate Neptune pull; the current build's scope determines how this build treats them.

Canonical values:

| Annotation value | The marked subtree is built into                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `header`         | `parts/header.html` (separate pull)                                                               |
| `footer`         | `parts/footer.html` (separate pull)                                                               |
| `post-content`   | the page's `post_content` (separate pull, when the surrounding template embeds `wp:post-content`) |

Resolve near-matches per "Resolving annotation values" above. Concretely: `Header`, `site-header`, `page-header`, `top-bar`, `masthead` all collapse to the canonical `header`. `Footer`, `site-footer`, `page-footer`, `colophon` all collapse to `footer`. `post-content`, `content-body`, `entry-content`, `main-content`, `post-body` all collapse to `post-content`.

Hold region-scope to a stricter bar than block-mapping. These annotations drive PIPELINE behaviour — which markup ends up in which template artifact — so an ambiguous match here produces silently wrong output (e.g. the page body getting routed into `parts/header.html`). If a value isn't a clear near-match for one of the three canonical regions, do NOT semantically promote it; treat the annotation as informational and let the standard rules handle the subtree. Specifically, generic labels like `main`, `body`, `content`, `wrapper`, `container` do NOT match `post-content` unless surrounding context (Figma layer name, dev annotations, scope instruction) makes the intent unmistakable.

Per-scope rules:

#### Scope: PAGE

- Convert the main content region.
- For any `header` / `footer` subtree present in code.tsx, emit a `wp:template-part` reference at the appropriate position — `<!-- wp:template-part {"slug":"header"} /-->` and `<!-- wp:template-part {"slug":"footer"} /-->`. Do NOT inline their contents; the parts are built and rendered separately.

#### Scope: HEADER

- Convert ONLY the subtree marked `data-neptune-annotations="header"`. If no such marker exists, treat the entire input as the header.
- Ignore `footer` and `post-content` subtrees entirely.
- Do NOT emit `wp:template-part` references — your output IS the header part.

#### Scope: FOOTER

- Convert ONLY the subtree marked `data-neptune-annotations="footer"`. If no such marker exists, treat the entire input as the footer.
- Ignore `header` and `post-content` subtrees entirely.
- Do NOT emit `wp:template-part` references — your output IS the footer part.

#### Scope: WRAPPER

The template embeds the page body via `wp:post-content`.

- The TSX has exactly one node marked `data-neptune-annotations="post-content"`. Replace that subtree with `<!-- wp:post-content /-->`. Do NOT convert the marked subtree itself — it becomes the page's `post_content` and is built separately.
- Convert the chrome around it (post title, post date, comments, sidebars, etc.).
- For any `header` / `footer` subtree, emit a `wp:template-part` reference exactly as in PAGE scope.

#### Scope: POST-CONTENT-BODY

The output IS the page body (`post_content`); the surrounding template (header, post-title, post-date, footer, etc.) is owned by a separate WRAPPER pull.

- Convert ONLY the subtree marked `data-neptune-annotations="post-content"`.
- Ignore `header` and `footer` subtrees entirely.
- Do NOT emit `wp:template-part` (the wrapper template owns those references).
- Do NOT emit `wp:post-content` (your output IS the post content).
- Do NOT emit `wp:post-title`, `wp:post-date`, etc. as page-level chrome — those belong to the wrapper. Exception: inside a `data-neptune-annotations="query-loop"` subtree, `wp:post-title` / `wp:post-date` etc. are per-iteration placeholders for each looped post, not for the current page; they are required and allowed there.

## Registered patterns

When the user supplies a `=== registered patterns ===` section, every entry is a block pattern already registered in the theme. The shape is `[{name, slug}, …]`. The `name` matches the PascalCase function name of the pattern in code.tsx; the `slug` is the WordPress-registered slug (`<theme>/<kebab>`).

If code.tsx contains a JSX element whose tag name matches an entry's `name` exactly (case-sensitive), emit one block in its place:

```
<!-- wp:pattern {"slug":"<slug>"} /-->
```

Use the `slug` field verbatim — do NOT recompute it from the name. The `wp:pattern` block is self-closing; it has no children and no other attributes.

Rules:

- Match by JSX tag name only. `<HeroCallout />` and `<HeroCallout variant="dark" />` both match the registered name `HeroCallout`. Props are ignored — `wp:pattern` is a static reference, not a component invocation.
- The function is usually defined as a top-level sibling in the same code.tsx file. **Ignore that function's body** when emitting the pattern reference — the registered pattern is canonical, even if the inline function differs slightly.
- Do not emit `wp:pattern` for a name that's not in the inventory. If a function call has no matching entry, inline its body the normal way.
- When converting the inline body of a function that IS in the inventory (i.e. you're walking into it because the JSX is the function definition itself rather than a JSX call to it), still emit `wp:pattern` for outer JSX calls to it elsewhere — but do not recursively rewrite the definition itself.
- The pattern reference replaces the entire JSX element subtree the call expands to. Don't keep wrapping divs that exist only to host the call.

## Output format

Return ONLY a single JSON object. No markdown fences. No preamble. No commentary. No explanation.

```jsonc
{
	"template_html": "<!-- wp:group ... --><!-- /wp:group -->",
	"theme_json_patch": {
		"blocks": {
			"core/heading": {
				"typography": {"letterSpacing": "-0.02em"},
			},
		},
		"custom": {
			"hero": {"ribbonOffset": "24px"},
		},
	},
	"block_style_variations": [
		{
			"slug": "neptune-fill-small",
			"title": "Fill Small",
			"blockTypes": ["core/button"],
			"styles": {
				"spacing": {
					"padding": {
						"top": "8px",
						"right": "16px",
						"bottom": "8px",
						"left": "16px",
					},
				},
				"typography": {"fontSize": "14px"},
			},
		},
	],
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

## Where to put style information

Three channels carry the styling. Pick the one that matches the scope:

- **Project-wide** — `theme_json_patch.blocks["core/<x>"]`. Deep-merged into `theme.json.styles.blocks`. Use this when every instance of the block type in the project should look this way (e.g. all images rounded, all author bios in the secondary colour).
- **One-off per-instance** — a structured `"style":{...}` JSON attribute in the block comment (e.g. `<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|7","bottom":"var:preset|spacing|7"}}}} -->`). This is the canonical Gutenberg channel for a single block whose values aren't shared with siblings — section padding, a one-off background, a one-off border radius. `save()` reads `attrs.style.*` and emits the matching HTML automatically; block validation always holds because both sides derive from the same JSON.
- **Recurring shape that needs a name** — a `block_style_variations[]` entry the block claims via `is-style-<slug>`. Use this only when the SAME constellation of styles will appear on multiple blocks of the same type with a coherent visual identity worth naming ("Filled Card", "Outline Tag", "Inverse Site Title").

What IS forbidden, without exception: a raw HTML `style="..."` attribute (including empty `style=""`) HAND-WRITTEN on the rendered HTML inside the block markup. The parser re-runs `save()` and compares; a hand-written attribute almost never matches the reconstructed form, and the editor reports "this block contains unexpected or invalid content". The fix is never "promote everything to a variation" — it's to set `"style":{...}` in the block comment's JSON attributes and let `save()` render the matching HTML.

The single biggest failure mode in this conversion is "I'll just add a `className` and key a CSS rule off it." That move bypasses every structured surface WordPress exposes and produces output the editor can't introspect. Before you reach for a custom `className` + CSS combo, work the cheat sheet and the `layout` attribute below — most of what feels like "I need raw CSS" is really an unused structured property or the wrong block attribute.

### Structured properties to check before reaching for `css`

The theme.json `styles` shape (which is also the shape inside `block_style_variations[].styles` and `theme_json_patch.blocks["core/<x>"]`) carries far more than color and typography. Walk this list before deciding a value needs `css`:

- `spacing.padding`, `spacing.margin` — top/right/bottom/left, with preset refs (`var:preset|spacing|<slug>`) or raw lengths.
- `spacing.blockGap` — gap between child blocks. Use this in place of `gap:var(...)` inside a `css` field.
- `dimensions.minHeight` — supported on `core/group`, `core/cover`, etc. Use `"dimensions":{"minHeight":"48px"}` instead of `min-height:48px;` in `css`.
- `dimensions.aspectRatio` — supported on `core/image`, `core/cover`, `core/post-featured-image`, `core/group`. Accepts ratios (`"16/9"`, `"906/452"`) or named slugs. Use this instead of `aspect-ratio:...` in `css`.
- `border.radius`, `border.color`, `border.width`, `border.style` — and per-side variants (`border.top.color`, `border.bottom.width`, ...).
- `shadow` — preset slug or raw shadow value.
- `outline.color`, `outline.style`, `outline.width`, `outline.offset`.
- `filter.duotone` — preset slug.
- `typography.fontFamily/Size/Weight/Style/LetterSpacing/LineHeight/TextDecoration/TextTransform/TextColumns/WritingMode`.
- `color.background`, `color.text`, `color.gradient`.

What legitimately requires `css` and has no structured equivalent: `display`, `flex-direction`, `align-items`, `justify-content` _as variation styling_ (see "Layout attribute" below for the instance path), `box-sizing`, child-element selectors (`& img`, `& .wp-block-button__link`), `:hover`/`:focus` states, `@media` breakpoints. Reach for `css` for these — not for properties already listed in the cheat sheet.

### Layout attribute on block instances

`wp:group` (and `wp:columns`, `wp:cover`) takes a `layout` block ATTRIBUTE that selects the container type and exposes structured controls. This is NOT under `style:{...}` — it sits at the top level of the block's attributes, alongside `align` and `className`. It is the right channel for almost every flex / grid / constrained container in a Tailwind-derived TSX.

- `layout:{"type":"flex","orientation":"horizontal"|"vertical","justifyContent":"left"|"center"|"right"|"space-between","flexWrap":"wrap"|"nowrap","verticalAlignment":"top"|"center"|"bottom"}`
- `layout:{"type":"grid","columnCount":N}` — fixed N-column grid. Or `{"type":"grid","minimumColumnWidth":"240px"}` for an auto-fit grid.
- `layout:{"type":"constrained"}` — centered content. `contentSize` and `wideSize` come from `theme.json.settings.layout` and are applied automatically; do NOT redeclare them on the block instance unless the section legitimately departs from the project-wide widths (rare). See "Width and alignment" below.
- Pair with `style:{"spacing":{"blockGap":"var:preset|spacing|<slug>"}}` for the gap between children.

When the source TSX has `<div class="grid grid-cols-3 gap-8">`, the right output is `wp:group` with `layout:{"type":"grid","columnCount":3}` plus `style.spacing.blockGap` — NOT a `karla-card-grid` `className` whose CSS rule lives in `theme_json_patch.blocks["core/group"].css`. The structured `layout` attribute is purpose-built for this; the className route is invisible to the editor and competes with sibling overrides on specificity.

### Width and alignment

`theme.json.settings.layout.contentSize` and `settings.layout.wideSize` define the project-wide content and wide widths. Every block honors these via the `align` attribute on the block instance — not via a per-block `contentSize`/`wideSize`. Read those two values from theme.json before deciding how to express width.

Width hierarchy — pick the FIRST option that matches the section's intent:

1. **No `align`** (the default) — content sits at `contentSize`. Use this for body copy, paragraphs, in-flow text and most content blocks. Do NOT redeclare `contentSize` on the instance to "make it explicit"; the value already lives in theme.json.
2. **`align:"wide"`** — content sits at `wideSize`. Use this for sections that visually span past the body column (image bands, callout strips, multi-column grids that should breathe wider than text).
3. **`align:"full"`** — content fills the viewport edge-to-edge. Use this for full-bleed sections (hero, footer chrome, edge-aligned background regions).
4. **Side padding** — when a section needs to be narrower than `contentSize`, add `style.spacing.padding.left` / `padding.right` (preferably referencing `var:preset|spacing|<slug>`) on the block. Padding is the right knob for inset content; do NOT shrink the block by setting a custom `contentSize`.
5. **Per-instance `contentSize`/`wideSize`** — last resort, escape hatch only. Allowed when a single one-off region MUST diverge from the project-wide widths AND `align` + side padding cannot express the intent. This should appear at most once or twice in a typical page; if you find yourself reaching for it on multiple sibling sections, the project-wide values in theme.json are wrong and should be raised with the user, not patched per-instance.

When `theme.json.settings.layout.contentSize` or `wideSize` is empty (`""`), DON'T fill the gap by hard-coding widths on every group — emit the block with `align:"wide"` / `align:"full"` / no align as appropriate and the project-wide values will start working as soon as the user fills them in. The TSX page width is a hint, not the truth: a 1440-wide Figma frame doesn't mean every group should be 1440 wide; it usually means the `align:"full"` regions are 1440 and the `align:"wide"` / default-width regions are narrower.

Tailwind translation cheat:

- `<div class="max-w-7xl mx-auto">` (centered, body-width container) → `wp:group` with `layout:{"type":"constrained"}` and NO align. Don't pin `contentSize` to `1280px` — let theme.json drive it.
- `<div class="w-full">` background strip wrapping a centered child → `align:"full"` on the outer group; the inner constrained group sits at the project-wide content width.
- `<section class="max-w-screen-md ...">` clearly narrower than the rest of the page → `align` defaults; add `style.spacing.padding.left/right` to inset further (or, if it's a recurring shape, register a `block_style_variations[]` entry that owns the inset and apply `is-style-<slug>`).

### Priority order

For every styling decision, work top-down and stop at the first option that fits.

1. **A theme.json preset slug** already in `theme.json` — `{"backgroundColor":"<slug>"}`, `{"textColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`. Always prefer this when a preset matches.
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties (color/typography/spacing/dimensions/border/shadow/outline/elements). Use this when the value applies to EVERY instance of the block type in the project (e.g. all images get `border.radius:4px`, all author bios use the secondary colour). Read what's already at `theme.json.styles.blocks["core/<x>"]` first; your patch extends that subtree. Walk the cheat sheet above before deciding a value isn't structured.
3. **A structured `"style":{...}` JSON attribute on the block instance** — for one-off per-instance values that aren't shared with siblings. Section padding, a single block's background, a one-off border radius, a one-off `dimensions.minHeight`. The block parser reads these and `save()` renders the matching HTML, so validation always holds. Use whenever the value lives on exactly one block (or a small number of clearly-distinct blocks) and there's no reusable identity worth naming. Walk the cheat sheet above to confirm the property is structured.
4. **An existing block style variation** — if `=== existing block style variations ===` contains an entry whose `styles` already matches what you need, apply its `is-style-<slug>` class. Do NOT redeclare in `block_style_variations[]`.
5. **A new block style variation** in `block_style_variations[]` — register one only when BOTH (a) the same constellation of styles will (or already does) appear on multiple instances of the same block type, AND (b) the shape has a coherent visual identity worth naming as an editor option ("Filled Card", "Outline Tag", "Inverse Site Title"). Forcing question: "if a future editor user looks at the style switcher, will this name read as a meaningful style choice?" If the answer is "no, it's just the padding this one section needed" — that's option 3, not a variation. Use structured properties inside `styles` first; only fall through to `styles.css` when the rule isn't structured.
6. **The `layout` attribute on the block instance** — for flex / grid / constrained containers, set `wp:group`'s `layout:{...}` (see "Layout attribute" above). This is the right channel for `display:flex`, `justify-content`, `flex-wrap`, `grid-template-columns:repeat(N,1fr)`. Do NOT emulate these by writing CSS keyed off a custom `className`.
7. **CSS** in a `.css` field — only when the rule cannot be expressed as a structured property AND is not a `layout` choice (pseudo-selectors, child-element selectors, animations, complex states, media-query refinements). Use `theme_json_patch.blocks["core/<x>"].css` for project-wide rules or a variation's `styles.css` for scoped ones. Inside the `css` value, prefer `&{...}` (the block itself) and block-internal descendant selectors (`& img`, `& .wp-block-button__link`); a variation's own `&.is-style-<slug>{...}` selector is also fine. Avoid `&.<custom-class>{...}` selectors that depend on a `className` you invented for the purpose — those are the className-as-CSS-hook anti-pattern (see Hard rules).

Raw HTML `style="..."` attributes on the rendered HTML elements inside block markup are FORBIDDEN — they fail Gutenberg's block validation. If you want to set a value per-instance, set it in the block comment's `"style":{...}` JSON (option 3); don't hand-write the resulting HTML attribute yourself.

NEVER write to `styles.css` or any other top-level theme.json key. NEVER emit raw CSS outside `theme_json_patch.blocks.<x>.css` or a variation's `styles.css`. The site's `style.css` file is off-limits.

### Worked examples

**When to register a variation.** Three callout cards in a row, each rendered as `<a className="bg-zinc-900 text-white p-6 rounded-lg" href="…">…</a>`.

- Wrong: three `wp:button` blocks with raw `style="..."` HTML attrs setting background/color/padding/border-radius — fails block validation.
- Wrong: three `wp:button` blocks each carrying the same instance-level `style:{...}` JSON. Same values declared three times, with no shared name — future editors can't tell these are "the callout style".
- Right: register one `neptune-callout` variation covering `color.background`, `color.text`, `spacing.padding`, `border.radius`. Apply `is-style-neptune-callout` on each button. Future siblings reuse the class. The shape has a name; the name appears in the editor's style switcher.

**When to set the style on the block instance.** A single hero section needs `48px / 0 / 64px / 0` padding — no other section uses these exact values, and "padding the hero section needs" has no coherent identity to name.

- Wrong: register a `neptune-section-hero` variation whose only contents are this padding. The variation never recurs and "Hero Section" is a region label, not a style.
- Wrong: raw `style="padding:48px 0 64px 0"` HTML on the rendered group — fails block validation.
- Right: `<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|7","right":"0","bottom":"var:preset|spacing|8","left":"0"}}}} -->`. The block comment carries the structured attribute; `save()` renders the matching HTML.

**When to extend `theme_json_patch.blocks`.** A single `<h2 class="tracking-tight">` (letter-spacing −0.02em), no matching preset, every heading in the project should pick this up.

- Wrong: instance-level `{"style":{"typography":{"letterSpacing":"-0.02em"}}}` on this `wp:heading`. Solves it here, but future headings won't pick it up.
- Wrong: a raw `style="letter-spacing:-0.02em"` HTML attribute. Breaks block validation.
- Right: emit `theme_json_patch.blocks["core/heading"].typography.letterSpacing = "-0.02em"`. Every `wp:heading` inherits cleanly; the existing `theme.json.styles.blocks["core/heading"]` subtree gets extended, not overwritten.

**When to use `layout` on the instance.** Three media cards in a 3-column responsive grid: `<div class="grid grid-cols-3 gap-8 max-md:grid-cols-1"><MediaCard/><MediaCard/><MediaCard/></div>`.

- Wrong: `wp:group` with `"className":"karla-media-grid"` and a `theme_json_patch.blocks["core/group"].css` rule `&.karla-media-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--wp--preset--spacing--32);} @media (max-width:900px){&.karla-media-grid{grid-template-columns:1fr;}}`. The `karla-media-grid` className is invisible to the editor, the rule competes for specificity with other `core/group` overrides, and the next 3-column grid copies the same pattern under a fresh `className`.
- Right: `wp:group` with `"layout":{"type":"grid","columnCount":3}` and `"style":{"spacing":{"blockGap":"var:preset|spacing|32"}}`. No custom `className`. Each child claims `is-style-neptune-media-card` (a registered variation that owns the card's padding / border / shadow). The mobile single-column fallback is the only thing that legitimately escapes — and it goes inside the variation's `styles.css` as `@media (max-width:900px){&{...}}`, scoped to the variation, not keyed off an ad-hoc class.

**When NOT to invent a `className`.** A flex row with logo on the left and CTA on the right: `<div class="flex justify-between items-center px-8 py-4">...</div>`.

- Wrong: `wp:group` with `"className":"karla-header-row"` plus a `&.karla-header-row{display:flex;justify-content:space-between;align-items:center;padding:...;}` CSS rule.
- Right: `wp:group` with `"layout":{"type":"flex","justifyContent":"space-between","verticalAlignment":"center","flexWrap":"nowrap"}` and `"style":{"spacing":{"padding":{"top":"var:preset|spacing|16","right":"var:preset|spacing|32","bottom":"var:preset|spacing|16","left":"var:preset|spacing|32"}}}`. No custom `className`. Editor users see the layout controls; future header-row siblings get the same affordances by reusing the same attribute pattern.

## Custom design tokens

When a value isn't a preset and is reused across multiple blocks (e.g. a recurring offset, a custom radius), register it under `theme_json_patch.custom.<group>.<name>` and reference it via `var(--wp--custom--<group>--<name>)` in your block-scoped CSS. Don't inline the same magic number in three places — promote it.

## Block mapping

| TSX shape                                                     | Use this block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSX call whose tag name is in `=== registered patterns ===`   | `wp:pattern` with the matching `slug` — see "Registered patterns"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Top-level layout `<div>` wrapping a section                   | `wp:group` with an appropriate `layout` block ATTRIBUTE: `{"type":"constrained"}` for centered content (let theme.json supply `contentSize` / `wideSize`; pick width via `align:"wide"` / `align:"full"` / no align — see "Width and alignment"); `{"type":"flex","justifyContent":...,"flexWrap":...,"verticalAlignment":...}` for flex rows/columns; `{"type":"grid","columnCount":N}` (or `"minimumColumnWidth"`) for grids. Pair with `style.spacing.blockGap` for inter-child gap. Do NOT emulate flex/grid via a custom `className` keyed to a CSS rule, and do NOT pin `contentSize`/`wideSize` per-instance to mirror the Figma frame width. |
| `<h1>`…`<h6>`                                                 | `wp:heading` with `level` attribute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `<p>` / span text runs                                        | `wp:paragraph`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `<a>` styled like a button (background, padding, rounded)     | `wp:button` inside `wp:buttons`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `<a>` plain text link, or text link in nav                    | `wp:paragraph` with an `<a>`, or `wp:navigation-link` if inside a nav                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `<img>` with const source in the mapped entries of `=== media library mappings ===` | `wp:image` (id + url from the mapped entry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `<img>` with const source in the discarded entries (or absent from the section) | See "Handling SVG and unmapped image references" — read the discarded-entry description if present, then translate to a structural replacement; never an empty `wp:image`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Two-column / three-column grids                               | `wp:columns` containing `wp:column` children                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `<ul>` / `<ol>`                                               | `wp:list` with nested `wp:list-item`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Inline `<svg>`                                                | See "Handling SVG and unmapped image references" — `wp:html` is a last resort                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Repeating items rendered via `.map(...)`                      | Default: inline the rendered result. Do NOT generate dynamic blocks. Exception: when the `.map` is inside a `data-neptune-annotations="query-loop"` subtree, convert the single map-iteration body into the post-template instead — see "Container-mapping annotations".                                                                                                                                                                                                                                                                                                                                                                            |

If a piece of TSX is purely presentational scaffolding (e.g. an empty wrapper div with only `flex` utilities), collapse it. Don't translate one-for-one if it adds nothing.

### Before styling a `core/paragraph`, check that paragraph is the right block

A common failure mode is reaching for a `core/paragraph` plus a variation when a more specific block already covers the case. Before you emit ANY styling (variation, theme.json patch, or instance-level `style`) on a `wp:paragraph`, run this checklist:

- **Navigation links.** A `<nav>` containing anchor-style links → `wp:navigation` + `wp:navigation-link`, NOT `wp:paragraph` with link styling. The Site Editor expects navigation blocks for the global nav; paragraph variations for "nav link" make the menu uneditable from the editor's navigation panel.
- **Standalone links / "Read more" / inline link copy.** Theme.json `styles.elements.link` already covers project-wide link colour, decoration, and hover. If the design relies on that styling, emit the link inside a `wp:paragraph` and let `elements.link` do its job — don't register a `link-text` paragraph variation that re-states the link colour.
- **Pull-quotes / block quotes.** A visually-quoted passage → `wp:quote` (which has its own `theme.json.styles.blocks["core/quote"]` subtree) or `wp:pullquote`. Paragraph + "quote" variation duplicates styling that already lives on the quote block.
- **Image captions.** A caption underneath an image → the `caption` attribute on the `wp:image` block (rendered as `<figcaption>`), NOT a sibling `wp:paragraph`. Caption styling goes in `theme_json_patch.blocks["core/image"].elements.caption` or the equivalent.
- **Just a bigger / smaller paragraph.** If the only difference is font size and a matching preset slug exists in `theme.json.settings.typography.fontSizes`, set `{"fontSize":"<slug>"}` on the paragraph instance. A variation whose only contribution is "uses a different preset font size" is wasted overhead.
- **Eyebrow / tag / badge text patterns.** These ARE legitimate paragraph variations when they recur across the design and have a coherent identity. But split typography (recurring across all eyebrows) from chrome (border + padding for the badge variant): typography lives in a base eyebrow variation; the badge's border and padding go on the specific paragraph instances that need them via instance-level `"style":{...}`, not a second near-duplicate variation.
- **Author / byline / metadata.** When the source TSX is rendering post metadata, the right blocks are `core/post-author`, `core/post-author-name`, `core/post-author-biography`, `core/post-date`, `core/post-terms`. Style those blocks via `theme_json_patch.blocks["core/post-*"]` rather than paragraph variations.

Before registering or applying any variation on `core/paragraph`, name the design intent ("nav link", "quote", "caption", "eyebrow") and confirm the answer above is "paragraph is still the right block". If the answer is "use a different block", switch the block; don't paper over it with a paragraph variation.

## Forms

When code.tsx contains a `<form>` (or any field input that is clearly part of a contact / lead-capture / signup flow), use the Jetpack form blocks. The Jetpack plugin is a project dependency, so these blocks are always available; do NOT hand-roll form markup with `wp:html` and never emit a `core/button` for form submission — it doesn't trigger Jetpack's submission handler.

Every form is structured as a single `jetpack/contact-form` parent containing field blocks plus a `jetpack/button` submit. Standalone field blocks outside the wrapper do not function — wrap or omit.

### Form-block mapping

| JSX shape                                                                  | Jetpack block                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| `<form>`                                                                   | `jetpack/contact-form` (wraps everything below)  |
| `<input type="text">`                                                      | `jetpack/field-text`                             |
| `<input>` whose label/name is "Name" / "Full name" / "First name"          | `jetpack/field-name`                             |
| `<input type="email">`                                                     | `jetpack/field-email`                            |
| `<input type="tel">` / `<input type="phone">`                              | `jetpack/field-phone`                            |
| `<input type="url">`                                                       | `jetpack/field-website`                          |
| `<input type="number">`                                                    | `jetpack/field-number`                           |
| `<input type="date">`                                                      | `jetpack/field-date`                             |
| `<input type="range">` / slider UI                                         | `jetpack/field-slider`                           |
| `<input type="checkbox">`                                                  | `jetpack/field-checkbox`                         |
| `<input type="radio">`                                                     | `jetpack/field-radio`                            |
| `<select>`                                                                 | `jetpack/field-select`                           |
| `<textarea>`                                                               | `jetpack/field-textarea`                         |
| `<input type="file">`                                                      | `jetpack/field-file`                             |
| `<input type="hidden">`                                                    | `jetpack/field-hidden`                           |
| Star / heart rating widget                                                 | `jetpack/field-rating`                           |
| Terms-of-service / consent checkbox separate from generic checkbox fields  | `jetpack/field-consent`                          |
| `<input type="submit">` / `<button type="submit">` / "Send" / "Submit" CTA | `jetpack/button` (inside `jetpack/contact-form`) |

### Attribute extraction

Read field attributes from the JSX:

- `label` — from the visible label text. Prefer a sibling `<label>` element's text; fall back to the input's `name`, `aria-label`, or surrounding heading. Never leave `label` empty.
- `required` — `true` when the JSX has the `required` attribute or the visible label contains a required marker (`*`, "required", etc.).
- `placeholder` — copy from the JSX `placeholder` attribute when present.
- `defaultValue` — copy from `defaultValue` / `value` when the JSX defines one.
- `options` (for `field-select`, `field-radio`, `field-checkbox`) — read each `<option>` (or radio/checkbox sibling) into the array; preserve order.
- `width` — when a row of fields uses Tailwind grid/flex utilities to put two side-by-side, set each field's `width` to `50` (50%); for three-up use `33` etc. The width attribute is the channel for inline form layout — do NOT wrap fields in `wp:columns` to achieve this.

### Form layout

- Field width is governed by each field block's `width` attribute (25 / 50 / 75 / 100). The form wrapper handles flow layout automatically.
- Apply spacing between the wrapper and its surroundings via `style.spacing` on `jetpack/contact-form` itself, NOT by inserting `wp:spacer` blocks between fields.
- Style the submit button by setting attributes on `jetpack/button` (`text`, `backgroundColor`, `textColor`, `borderRadius`, `width`). Don't reach for a `core/button` block beside the form to "match the design" — it won't submit.

## Handling SVG and unmapped image references

Two cases produce no mapped media entry: (a) `<img src={imgFoo}>` where `imgFoo` references an SVG asset (Figma generates these for non-bitmap visuals — dividers, ornaments, icons), and (b) inline `<svg>...</svg>` markup directly in the JSX. In both cases the right output is a STRUCTURED block expression of the visual's intent — NOT a `wp:image` with empty `src` (forbidden — renders as a broken-image placeholder), and NOT necessarily `wp:html` with raw SVG.

Picking the right interpretation: combine the available signals in this order:

1. **Discarded-entry description** in `=== media library mappings ===` (case (a) only). When the const appears in the discarded-entries list, the line gives you a 1-sentence record of what the rendered image actually depicted, written by the triage agent that saw it. This is the strongest signal — read it before falling back to JSX inspection. For lines tagged `[render failure]` the description is the renderer's error message, not visual intent — fall back to JSX context for those.
2. **JSX context** — dimensions, position, parent classes, alt/aria attributes, sibling structure. The only signal in case (b), and the fallback in case (a) when no description is available.
3. **Inline SVG bytes** (case (b) only) — `<path>`, `<rect>`, stroke widths, fills, gradients. Useful for confirming a category (e.g. a single-segment narrow-stroke path is a divider).

Walk this priority order and stop at the first option that fits.

1. **Decorative line / divider** (single-segment path, narrow stroke, full-width or full-height span). Examples: a `<svg viewBox="0 0 1376 1">` with a single horizontal `<path>`; a 1px-tall absolutely-positioned div between two sections. Emit `wp:separator` when the line stands alone between siblings, or apply `border.top` / `border.bottom` / `border.left` / `border.right` on the parent block when the line is the parent's edge. Read the colour from the SVG's `stroke` (or surrounding CSS variable); if it resolves to a theme.json palette slug, use the slug.
2. **Background ornament** (filled shape positioned absolutely behind content, decorative blob, gradient stripe). Translate to `style.color.background` / `style.color.gradient` on the parent block, or to a `background-image` rule on a registered `block_style_variations[]` entry that the parent block claims via `is-style-<slug>`. Drop the SVG element from the block tree.
3. **Icon glyph used like an emoji or button affordance** (small, square, inline with text). Drop the element entirely if it is purely decorative (the design is still legible without it). Only when the icon is semantically required AND the SVG markup is inline in the JSX (you can read its `<path>` data), emit `wp:html` containing the SVG verbatim. Never emit `wp:html` for an external `<img src={…}>` SVG reference — you do not have the bytes.
4. **Last resort**: if the visual cannot be expressed structurally and is not safely droppable, omit the element. Empty `wp:image` is NEVER acceptable.

This rule applies whether the SVG is inline in JSX or referenced via an unmapped `<img src={…}>`.

## Mapping Tailwind to block attributes

When a Tailwind class corresponds to a preset slug in `theme.json`, prefer the named attribute over a raw `style`:

- Background that matches `settings.color.palette[i].slug` → `{"backgroundColor":"<slug>"}`
- Text colour that matches a palette slug → `{"textColor":"<slug>"}`
- Font size that matches `settings.typography.fontSizes[i].slug` → `{"fontSize":"<slug>"}`
- Padding/margin that matches `settings.spacing.spacingSizes[i].slug` → use the `style.spacing` shape with `var:preset|spacing|<slug>` references

When no preset matches, pick by scope:

- **Every instance of the block type should look this way** → `theme_json_patch.blocks["core/<x>"]`, extending the existing `theme.json.styles.blocks["core/<x>"]` subtree.
- **One block (or a small set with no shared identity) needs this value** → set the structured property in the block comment's `"style":{...}` JSON. The block parser reads it and `save()` emits the matching HTML.
- **The same constellation recurs across multiple blocks of the same type with a coherent named identity** → register a `block_style_variations[]` entry and apply `is-style-<slug>` on each instance.

Raw HTML `style="..."` attributes on the rendered HTML are NOT a fallback — they fail Gutenberg's block validator on parse. The block-comment JSON form (`"style":{...}` in the comment) is the supported per-instance channel.

When a class uses a CSS variable like `var(--eureka/contrast-1,#21201c)`, resolve via `theme.json` if there's a matching preset; otherwise look up the resolved value in `variables.json` and use that hex/length directly.

## Hard rules

- Every opening block comment must have a matching closing comment (`<!-- wp:foo --> ... <!-- /wp:foo -->`).
- JSON in block comment attributes must be valid: no trailing commas, no comments, double-quoted keys.
- NEVER emit a raw HTML `style="..."` attribute (including `style=""`) on the rendered HTML elements inside block markup. The block parser re-runs the block's `save()` function and rejects markup whose inline style attributes don't match what `save()` would emit, surfacing as "this block contains unexpected or invalid content" in the editor. Hand-written `style="..."` attributes never match. Per-instance styling goes in the block comment's `"style":{...}` JSON (option 3 in the priority order); `save()` then emits the matching HTML automatically.
- Instance-level `"style":{...}` JSON in the block comment IS allowed (and is the canonical channel for per-block one-off values) — the block parser reads it and `save()` renders the corresponding HTML. Use it for one-off `spacing`, `color`, `border`, `dimensions`, `typography` values that don't recur across siblings and don't deserve a named variation. Do NOT use it to redeclare values that should live in `theme_json_patch.blocks["core/<x>"]` (project-wide) or in a registered variation (recurring + named identity) — see the priority order.
- Strip Figma's `data-node-id`, `data-name`, `data-neptune-annotations`, and `data-development-annotations` attributes from the output — they have no value in WordPress. Both annotation kinds still inform the conversion (semantic block selection / designer intent); they just don't appear in the emitted markup.
- Slugs are kebab-case, lowercase, alphanumeric + hyphens.
- Variation slugs in `block_style_variations[]` MUST be prefixed `neptune-` so they don't collide with theme defaults.
- When adding a border to a single edge of a block, ensure other edges are explicitly set to `0px` to avoid unintended borders from theme styles.
- Do NOT invent project-specific `className` values whose only purpose is to give a CSS rule a selector. If you find yourself wanting to write `theme_json_patch.blocks["core/<x>"].css = "&.foo{...}"` to back a class you just made up, choose instead one of: (a) a `block_style_variations[]` entry the block claims via `is-style-<slug>` (CSS keyed off `&.is-style-<slug>` or `&` inside the variation is fine — the variation's class is registered, not invented per-template); (b) structured properties on the block (`style.spacing`, `style.dimensions`, `style.border`, `style.typography`, ...) plus a `layout:{...}` attribute when the rule is layout. The `metadata.name` field on a block (used for human-readable labels in the editor's list view) is NOT a styling hook and is fine. Block-internal child selectors inside a variation's or block's `css` field (`& img`, `& .wp-block-button__link`, `& > .wp-block-group`) are also fine — they don't depend on a custom `className`.
- For `wp:image` blocks: resolve the source against the `=== media library mappings ===` section. If the JSX `<img>`'s `src` references a const that appears in the mapped entries (the `<constName> → id=<n>, url=<...>` lines), use that entry's `id` and `url` (`"id":<id>` in attrs, `<img src="<url>" class="wp-image-<id>">`). If the const appears in the discarded entries (the `<constName>: <description>` lines) or is absent from the section entirely, do NOT emit a `wp:image` — see "Handling SVG and unmapped image references" below. Empty `wp:image` (`src=""` with no `id`) is forbidden: WP renders it as a broken-image placeholder. Never use Figma's local asset URLs (`http://localhost:3845/...`) and never invent file paths.
- Never wrap the response in markdown code fences.

## Self-check before responding

1. No tools were called. Output is exactly one JSON object, valid, no fences, no prose.
2. `template_html` starts with `<!-- wp:` and balances opening/closing block comments. JSON inside every block comment attribute parses.
3. If `theme_json_patch` is present, it has only `blocks` and/or `custom` at the top level — no `variations` anywhere inside.
4. If `block_style_variations` is present, every entry's slug starts with `neptune-` AND its `is-style-<slug>` class appears on at least one block in `template_html`. Every `is-style-neptune-<slug>` class on a block is backed EITHER by an existing-variations inventory entry OR a new `block_style_variations[]` entry — never both, never neither.
5. CSS only used when no pre-exposed structured property could express the rule. Specifically, before writing any of `aspect-ratio`, `min-height`, `gap`, `padding`, `margin`, `border-*`, `box-shadow`, `outline-*`, `font-*`, `letter-spacing`, `line-height`, `text-transform`, `background`, or `color` into a `css` field, verify the structured equivalent (`dimensions.aspectRatio`, `dimensions.minHeight`, `spacing.blockGap`, `spacing.padding`, `spacing.margin`, `border.*`, `shadow`, `outline.*`, `typography.*`, `color.*`) cannot be used.
6. `template_html` contains zero raw HTML `style="..."` attributes (including empty `style=""`). Instance-level `"style":{...}` JSON in block comments IS allowed — verify each occurrence is a one-off value that doesn't belong in `theme_json_patch.blocks["core/<x>"]` (project-wide) or a `block_style_variations[]` entry (recurring + named). If the same `"style":{...}` shape appears on two-or-more sibling blocks of the same type, promote it (variation if it has a named identity, theme.json patch if it should apply project-wide).
7. Every flex / grid / constrained container uses the `layout` block attribute (`layout:{"type":"flex"|"grid"|"constrained",...}`) — NOT emulated via a custom `className` plus a CSS rule. Inter-child gap goes in `style.spacing.blockGap`, not a `gap:...` declaration in `css`.
8. No `wp:group` declares its own `contentSize` or `wideSize` under `layout` unless the section legitimately departs from project-wide widths (rare). Width is `align:"wide"` / `align:"full"` / no align, driven by `theme.json.settings.layout`. Narrower content uses `style.spacing.padding.left/right` (or a registered variation), not a custom `contentSize`.
9. Every `className` on a block is one of: `is-style-<slug>` (variation), a wp-core class (`alignwide`, `alignfull`, etc.), or a class explicitly required by the source TSX for behavior the agent is not free to drop. NO ad-hoc BEM-style handles whose sole job is to back `&.<name>{...}` rules. For every `&.<custom-class>{...}` selector that does appear in a `css` field, confirm `<custom-class>` is `is-style-<registered-slug>` — NOT a className you invented.
10. Every JSX call whose tag matches a `=== registered patterns ===` `name` was emitted as `<!-- wp:pattern {"slug":"<slug>"} /-->`, not inlined. Slug used verbatim.
11. No `function`, `import`, `const imgFoo`, or TypeScript syntax remains.
