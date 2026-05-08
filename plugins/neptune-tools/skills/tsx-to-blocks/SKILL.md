---
name: tsx-to-blocks
description: Use when converting a Figma-generated React + Tailwind component (code.tsx) into Gutenberg block markup for a WordPress block theme template or template part. Outputs a JSON envelope containing the block markup plus an optional theme.json patch for project-wide style registrations.
---

# TSX → Gutenberg block markup

You convert a single React + Tailwind component (the output of Figma's code generator) into Gutenberg block markup for a WordPress block theme.

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
- Optionally a `=== media library mappings ===` section listing `<constName> → id=<n>, url=<...>` entries. Each entry maps a `const imgFoo = "http://localhost:3845/..."` declaration in code.tsx to a real attachment already imported into the WordPress media library. See "Image handling" below.

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

Some TSX nodes carry a `data-neptune-annotations="<role>"` attribute. They fall into two distinct categories with different handling:

- **Block-mapping annotations** substitute the marked node 1:1 with a specific WordPress dynamic block.
- **Region-scope annotations** mark a structural region (header, footer, page body) that the build pipeline routes to its own template artifact. They are never converted in-place — the active scope (set by the user's scope instruction) dictates whether each region becomes a placeholder, a `wp:template-part` reference, gets sliced out, or IS the only region you convert.

Both kinds of annotations are stripped from the emitted markup; only their effect on the conversion remains.

### Block-mapping annotations

Substitute the marked node with the matching WordPress block instead of converting the visual literally. Drop the inner content of the annotated node — WordPress fills it at render time.

| Annotation value      | Emit                                                  |
| --------------------- | ----------------------------------------------------- |
| `post-title`          | `<!-- wp:post-title /-->`                             |
| `post-date`           | `<!-- wp:post-date /-->`                              |
| `post-author`         | `<!-- wp:post-author-name /-->`                       |
| `post-excerpt`        | `<!-- wp:post-excerpt /-->`                           |
| `post-featured-image` | `<!-- wp:post-featured-image /-->`                    |
| `post-navigation`     | `<!-- wp:post-navigation-link /-->` (next + previous) |
| `comments-list`       | `<!-- wp:comments /-->` with default child blocks     |

Do NOT also emit a `wp:heading` (or other literal block) next to `wp:post-title` for the same node — the dynamic block replaces the literal entirely.

### Region-scope annotations

These three values mark structural regions that live in their own template artifact. Each is built by a separate Neptune pull; the current build's scope determines how this build treats them.

| Annotation value | The marked subtree is built into                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `header`         | `parts/header.html` (separate pull)                                                               |
| `footer`         | `parts/footer.html` (separate pull)                                                               |
| `post-content`   | the page's `post_content` (separate pull, when the surrounding template embeds `wp:post-content`) |

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
- Do NOT emit `wp:post-title`, `wp:post-date`, etc. — those belong to the wrapper.

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

The default channel for styling a block is `theme_json_patch.blocks["core/<x>"]` — extending what's already in `theme.json.styles.blocks`. Inline `style` attributes on individual blocks are an exception, not a fallback, and require justification at three checks (see step 7). When in doubt, register; don't inline.

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
- `layout:{"type":"constrained","contentSize":"672px","wideSize":"1170px"}` — centered content with a max width and wide-align support.
- Pair with `style:{"spacing":{"blockGap":"var:preset|spacing|<slug>"}}` for the gap between children.

When the source TSX has `<div class="grid grid-cols-3 gap-8">`, the right output is `wp:group` with `layout:{"type":"grid","columnCount":3}` plus `style.spacing.blockGap` — NOT a `karla-card-grid` `className` whose CSS rule lives in `theme_json_patch.blocks["core/group"].css`. The structured `layout` attribute is purpose-built for this; the className route is invisible to the editor and competes with sibling overrides on specificity.

### Priority order

For every styling decision, work top-down and stop at the first option that fits.

1. **A theme.json preset slug** already in `theme.json` — `{"backgroundColor":"<slug>"}`, `{"textColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`. Always prefer this when a preset matches.
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties (color/typography/spacing/dimensions/border/shadow/outline/elements). DEFAULT channel for any value that isn't a preset slug. Read what's already at `theme.json.styles.blocks["core/<x>"]` first; your patch extends that subtree. Walk the cheat sheet above before deciding a value isn't structured.
3. **An existing block style variation** — if `=== existing block style variations ===` contains an entry whose `styles` already matches what you need, apply its `is-style-<slug>` class. Do NOT redeclare in `block_style_variations[]`.
4. **A new block style variation** in `block_style_variations[]` — register one whenever the same constellation of styles will (or already does) appear on multiple instances of the same block type with a coherent visual identity. Use structured properties inside `styles` first; only fall through to `styles.css` when the rule isn't structured (display/flex-direction, child-element selectors, media queries). Forcing question: "would I otherwise inline these same styles on a sibling block of the same type?" If yes, register the variation.
5. **The `layout` attribute on the block instance** — for flex / grid / constrained containers, set `wp:group`'s `layout:{...}` (see "Layout attribute" above). This is the right channel for `display:flex`, `justify-content`, `flex-wrap`, `grid-template-columns:repeat(N,1fr)`. Do NOT emulate these by writing CSS keyed off a custom `className`.
6. **CSS** in a `.css` field — only when the rule cannot be expressed as a structured property AND is not a `layout` choice (pseudo-selectors, child-element selectors, animations, complex states, media-query refinements). Use `theme_json_patch.blocks["core/<x>"].css` for project-wide rules or a variation's `styles.css` for scoped ones. Inside the `css` value, prefer `&{...}` (the block itself) and block-internal descendant selectors (`& img`, `& .wp-block-button__link`); a variation's own `&.is-style-<slug>{...}` selector is also fine. Avoid `&.<custom-class>{...}` selectors that depend on a `className` you invented for the purpose — those are the className-as-CSS-hook anti-pattern (see Hard rules).
7. **Raw inline `style` attribute on a block** — exception path. Allowed only when ALL THREE hold:
   - (a) No preset matches (step 1 fails).
   - (b) The value is unique to this single block instance — does NOT appear on any sibling block of the same type in this template, and you would not write the same value on a future sibling.
   - (c) The value would not naturally extend `theme.json.styles.blocks["core/<x>"]` for this block type — i.e. it's genuinely instance-specific, not a default the block type should inherit.
     If any of (a)–(c) fails, promote to step 2 or step 4.

NEVER write to `styles.css` or any other top-level theme.json key. NEVER emit raw CSS outside `theme_json_patch.blocks.<x>.css` or a variation's `styles.css`. The site's `style.css` file is off-limits.

### Worked examples

**When to register a variation.** Three callout cards in a row, each rendered as `<a className="bg-zinc-900 text-white p-6 rounded-lg" href="…">…</a>`.

- Wrong: three `wp:button` blocks with inline `style` attrs setting background/color/padding/border-radius. Same values, three places.
- Right: register one `neptune-callout` variation covering `color.background`, `color.text`, `spacing.padding`, `border.radius`. Apply `is-style-neptune-callout` on each button. Future siblings reuse the class.

**When to extend `theme_json_patch.blocks`.** A single `<h2 class="tracking-tight">` (letter-spacing −0.02em), no matching preset, no "callout" identity — just project-wide heading typography.

- Wrong: inline `{"style":{"typography":{"letterSpacing":"-0.02em"}}}` on this `wp:heading`. Future headings won't pick it up.
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

| TSX shape                                                     | Use this block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSX call whose tag name is in `=== registered patterns ===`   | `wp:pattern` with the matching `slug` — see "Registered patterns"                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Top-level layout `<div>` wrapping a section                   | `wp:group` with an appropriate `layout` block ATTRIBUTE: `{"type":"constrained","contentSize":...}` for centered content with a max width; `{"type":"flex","justifyContent":...,"flexWrap":...,"verticalAlignment":...}` for flex rows/columns; `{"type":"grid","columnCount":N}` (or `"minimumColumnWidth"`) for grids. Pair with `style.spacing.blockGap` for inter-child gap. Do NOT emulate flex/grid via a custom `className` keyed to a CSS rule — the structured `layout` attribute is purpose-built for this. |
| `<h1>`…`<h6>`                                                 | `wp:heading` with `level` attribute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `<p>` / span text runs                                        | `wp:paragraph`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `<a>` styled like a button (background, padding, rounded)     | `wp:button` inside `wp:buttons`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `<a>` plain text link, or text link in nav                    | `wp:paragraph` with an `<a>`, or `wp:navigation-link` if inside a nav                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `<img>` with const source in `=== media library mappings ===` | `wp:image` (id + url from the mapping)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `<img>` with const source NOT in the mapping (SVG ref)        | See "Handling SVG and unmapped image references" — never an empty `wp:image`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Two-column / three-column grids                               | `wp:columns` containing `wp:column` children                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `<ul>` / `<ol>`                                               | `wp:list` with nested `wp:list-item`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Inline `<svg>`                                                | See "Handling SVG and unmapped image references" — `wp:html` is a last resort                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Repeating items rendered via `.map(...)`                      | Inline the rendered result. Do NOT generate dynamic blocks.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

If a piece of TSX is purely presentational scaffolding (e.g. an empty wrapper div with only `flex` utilities), collapse it. Don't translate one-for-one if it adds nothing.

## Handling SVG and unmapped image references

Two cases produce no `=== media library mappings ===` entry: (a) `<img src={imgFoo}>` where `imgFoo` references an SVG asset (Figma generates these for non-bitmap visuals — dividers, ornaments, icons), and (b) inline `<svg>...</svg>` markup directly in the JSX. In both cases the right output is a STRUCTURED block expression of the visual's intent — NOT a `wp:image` with empty `src` (forbidden — renders as a broken-image placeholder), and NOT necessarily `wp:html` with raw SVG.

Use the JSX context — dimensions, position, parent classes, alt/aria attributes, sibling structure — to pick the right interpretation. Walk this priority order and stop at the first option that fits.

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

When no preset matches, the default channel is `theme_json_patch.blocks["core/<x>"]` — extending the existing `theme.json.styles.blocks["core/<x>"]` subtree. Raw inline `style` attributes are the exception path described in "Where to put style information" (step 6) — allowed only when all three of (a) no preset matches, (b) no sibling block of the same type carries the same inline value, and (c) the value would not naturally belong in the block type's project-wide styling.

When a class uses a CSS variable like `var(--eureka/contrast-1,#21201c)`, resolve via `theme.json` if there's a matching preset; otherwise look up the resolved value in `variables.json` and use that hex/length directly.

## Hard rules

- Every opening block comment must have a matching closing comment (`<!-- wp:foo --> ... <!-- /wp:foo -->`).
- JSON in block comment attributes must be valid: no trailing commas, no comments, double-quoted keys.
- Strip Figma's `data-node-id`, `data-name`, `data-neptune-annotations`, and `data-development-annotations` attributes from the output — they have no value in WordPress. Both annotation kinds still inform the conversion (semantic block selection / designer intent); they just don't appear in the emitted markup.
- Slugs are kebab-case, lowercase, alphanumeric + hyphens.
- Variation slugs in `block_style_variations[]` MUST be prefixed `neptune-` so they don't collide with theme defaults.
- When adding a border to a single edge of a block, ensure other edges are explicitly set to `0px` to avoid unintended borders from theme styles.
- Do NOT invent project-specific `className` values whose only purpose is to give a CSS rule a selector. If you find yourself wanting to write `theme_json_patch.blocks["core/<x>"].css = "&.foo{...}"` to back a class you just made up, choose instead one of: (a) a `block_style_variations[]` entry the block claims via `is-style-<slug>` (CSS keyed off `&.is-style-<slug>` or `&` inside the variation is fine — the variation's class is registered, not invented per-template); (b) structured properties on the block (`style.spacing`, `style.dimensions`, `style.border`, `style.typography`, ...) plus a `layout:{...}` attribute when the rule is layout. The `metadata.name` field on a block (used for human-readable labels in the editor's list view) is NOT a styling hook and is fine. Block-internal child selectors inside a variation's or block's `css` field (`& img`, `& .wp-block-button__link`, `& > .wp-block-group`) are also fine — they don't depend on a custom `className`.
- For `wp:image` blocks: resolve the source against the `=== media library mappings ===` section. If the JSX `<img>`'s `src` references a const whose name appears in the mapping, use that entry's `id` and `url` (`"id":<id>` in attrs, `<img src="<url>" class="wp-image-<id>">`). If the const is NOT in the mapping (typically an SVG reference: divider, ornament, icon), do NOT emit a `wp:image` at all — see "Handling SVG and unmapped image references" below. Empty `wp:image` (`src=""` with no `id`) is forbidden: WP renders it as a broken-image placeholder. Never use Figma's local asset URLs (`http://localhost:3845/...`) and never invent file paths.
- Never wrap the response in markdown code fences.

## Self-check before responding

1. Output is exactly one JSON object, valid, no fences, no prose.
2. `template_html` starts with `<!-- wp:` and balances opening/closing block comments.
3. JSON inside every block comment attribute parses.
4. If `theme_json_patch` is present, it has only `blocks` and/or `custom` keys at the top level — no `variations` anywhere inside.
5. If `block_style_variations` is present, every entry's slug starts with `neptune-` AND its `is-style-<slug>` class appears on at least one block in `template_html`.
6. Every `is-style-neptune-<slug>` class on a block in `template_html` is backed EITHER by an entry in the existing-variations inventory OR by a new entry in `block_style_variations[]` — never both. Do not redeclare a slug that's already registered.
7. CSS only used when no pre-exposed structured property could express the rule. Specifically, before writing any of `aspect-ratio`, `min-height`, `gap`, `padding`, `margin`, `border-*`, `box-shadow`, `outline-*`, `font-*`, `letter-spacing`, `line-height`, `text-transform`, `background`, or `color` into a `css` field, verify the structured equivalent (`dimensions.aspectRatio`, `dimensions.minHeight`, `spacing.blockGap`, `spacing.padding`, `spacing.margin`, `border.*`, `shadow`, `outline.*`, `typography.*`, `color.*`) cannot be used.
8. For every inline `style` attribute on a block in `template_html`, all three checks pass: (a) no theme.json preset matches, (b) no sibling block of the same type carries the same inline value, (c) the value would not naturally extend `theme.json.styles.blocks["core/<x>"]` for that block type. Any failure means promote to `theme_json_patch.blocks` or a `block_style_variations[]` entry.
9. Every flex / grid / constrained container in `template_html` uses the `layout` block attribute (`layout:{"type":"flex"|"grid"|"constrained",...}`) — NOT emulated via a custom `className` plus a CSS rule. Inter-child gap goes in `style.spacing.blockGap`, not a `gap:...` declaration in `css`.
10. Every `className` on a block in `template_html` is one of: `is-style-<slug>` (variation), a wp-core class (`alignwide`, `alignfull`, etc.), or a class explicitly required by the source TSX for behavior the agent is not free to drop. NO ad-hoc BEM-style handles whose sole job is to back `&.<name>{...}` rules in `theme_json_patch.blocks` or a variation. If a recurring visual identity needs a class anchor, register it as a `block_style_variations[]` entry instead.
11. For every `&.<custom-class>{...}` selector that does appear in any `css` field, confirm the `<custom-class>` is `is-style-<registered-slug>` — NOT a className you invented. CSS keyed off invented classes is the anti-pattern this skill exists to prevent.
12. Every JSX call whose tag matches a `=== registered patterns ===` `name` was emitted as `<!-- wp:pattern {"slug":"<slug>"} /-->`, not inlined. Slug used verbatim.
13. No `function`, `import`, `const imgFoo`, or TypeScript syntax remains.
