---
name: tsx-to-blocks
description: Use when converting a Figma-generated React + Tailwind component (code.tsx) into Gutenberg block markup for a WordPress block theme template, template part, or page body. The agent persists every artifact itself via the pull-writer skill — block markup to wp_template / wp_template_part / page / post posts via Haydi MCP, theme.json + block style variation files to disk via Edit / Write. No JSON envelope is returned to the host; the host parses a terse plaintext summary of what was written.
---

# TSX → Gutenberg block markup

Convert a single React + Tailwind component (the output of Figma's code generator) into Gutenberg block markup for a WordPress block theme.

## Operating mode

You are converting one TSX component to Gutenberg block markup AND persisting every artifact yourself — block markup, theme.json edits, block style variation files, cache flush. The host loads the **pull-writer** skill alongside this one; pull-writer ships the canonical recipes for each persistence step.

Available tools:

- `Read`, `Glob`, `Grep` — for inspecting the local theme + sibling templates if you need to.
- `Edit`, `Write` — for the local file edits (theme.json, `styles/blocks/*.json`). The host's working directory is the project root; the theme lives at `wordpress/wp-content/themes/<themeSlug>/`.
- `mcp__haydi__haydi_run_php` — for the wp_template / wp_template_part / page / post writes and the cache flush. See pull-writer Recipes 2, 4, 5.
- NO `Task` (no nested subagents). NO `Bash` (file ops go through Edit / Write).

Final response: a terse plaintext summary, one line per artifact written. NO JSON envelope. NO markdown fences around markup. NO narration.

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
| `post-comments`       | `<!-- wp:comments /-->` with default child blocks     |
| `site-logo`           | `<!-- wp:site-logo /-->`                              |

Do NOT also emit a `wp:heading` (or other literal block) next to `wp:post-title` for the same node — the dynamic block replaces the literal entirely.

#### Site-wide side-effect: `site-logo`

`wp:site-logo` is a SITE-wide block — it reads the `site_logo` option and the `custom_logo` theme mod and renders that one image everywhere it appears. Emitting the block is not enough: a fresh Studio site has no logo set, so the block renders an empty placeholder and the visual diff fails for the wrong reason.

After persisting markup that contains `<!-- wp:site-logo /-->`, call **pull-writer Recipe 10** (Set site logo) with the attachment id you resolve from the `imgFoo` constant that lived inside the annotated subtree (look it up in `=== media library mappings ===`). Recipe 10 updates the `site_logo` option AND `custom_logo` theme mod in one call, applies to every template that renders the block, and is idempotent — if the option already points at that attachment, it's a no-op.

This side-effect fires regardless of scope. A logo annotated inside a `header` region surfaces here from the HEADER pull's build; the same annotation in a non-header template surfaces from that template's build. Calling Recipe 10 twice with the same attachment id is safe.

Skip Recipe 10 when the annotated subtree carries no resolvable image (no `<img>` inside, or the inner `imgFoo` was a discarded SVG) and emit one line saying so.

### Container-mapping annotations

| Annotation value | Emit                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| `query-loop`     | `wp:query` wrapping a `wp:post-template` whose contents are the node's children |

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

#### Seeding posts so the loop renders

`wp:query` with `inherit:false` renders against the WordPress post DB. A fresh Studio site has one published post (the seed "Hello world", id 1), so a 6-card grid renders as a 1-card grid and every subsequent visual diff fails for the wrong reason.

After persisting markup that contains at least one `wp:query` with `inherit:false` and `postType:"post"`, call **pull-writer Recipe 8** (Seed posts for query loops) with `count` equal to the largest `perPage` across the query loops in the persisted markup. The recipe clones post 1 (content, excerpt, taxonomy terms, featured image, non-internal meta) the number of times needed to reach `count` published posts total; it is idempotent across re-runs.

Skip Recipe 8 entirely when the loop's `postType` is a CPT — the seed post is type `post`, and the recipe explicitly errors on a mismatched source type. Emit one line in your summary (`skipped seed: query loop over CPT 'products' — author manually`) so the human knows the loop will render empty until the CPT has rows.

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

This skill never emits a JSON envelope. The HOST never parses your text. You persist every artifact yourself, via the tool surface, then report a terse plaintext summary.

The host loads the **pull-writer** skill alongside this one. That skill ships the canonical recipes for every persistence operation you will run; follow them verbatim and only deviate when you have a specific reason that you also state in your summary.

### Scope: POST-CONTENT-BODY

You are converting the post body. There is no template wrapper, no project-wide style registration. Use **pull-writer Recipe 4** (Page / post write) to persist the converted markup to the wp_post the host names in the task brief (postType + slug + title). The marked subtree (`data-neptune-annotations="post-content"`) is what you convert; ignore header / footer / chrome around it.

After persisting, emit one line:

```
wrote <postType>:<slug> (id <N>, <bytes> bytes)
```

If the converted subtree contains `<!-- wp:post-featured-image /-->` (emitted from a `data-neptune-annotations="post-featured-image"` annotation), also call **pull-writer Recipe 9** (Set featured image) with the post id Recipe 4 returned and the attachment id you resolve from the `imgFoo` constant that lived inside the annotated subtree (look it up in `=== media library mappings ===`). The dynamic block renders `_thumbnail_id` — without Recipe 9 it renders empty and the visual diff against the design fails for the wrong reason. Skip Recipe 9 when the annotated subtree carries no resolvable image (no `<img>` inside, or the inner `imgFoo` was a discarded SVG) and emit one line saying so.

If you needed to register a project-wide style or a variation, push the rule back into the WRAPPER scope's pull — post bodies do not register project-wide styles.

### Scope: PAGE / HEADER / FOOTER / WRAPPER

You are converting a template (`wp_template`) or template part (`wp_template_part`). The host names the target `(type, slug, title)` in the task brief. You produce three logical artifacts; each persists through a different recipe:

| Artifact | Recipe | Mandatory? |
|---|---|---|
| Block markup | **pull-writer Recipe 2** (Template write) | Yes — always |
| theme.json extensions | **pull-writer Recipe 6** (theme.json Read + Write) | Only when the conversion legitimately registers new structured properties under `styles.blocks` / `settings.custom` |
| Block style variation file(s) | **pull-writer Recipe 7** (variation file Write) | Only when a recurring styled instance warrants registration; reuse existing variations from the context section first |

After ANY change to theme.json or `styles/blocks/*.json`, call **pull-writer Recipe 5** (cache flush) once at the end. One flush per run, not one per file.

#### Mandatory ordering

1. Write the template body to the wp_post FIRST (Recipe 2). The template references presets / variations that don't yet exist in the DB, but WP resolves those lazily; it is safe to register them after.
2. Apply theme.json patch (Recipe 6) if needed.
3. Write block style variation files (Recipe 7) if needed.
4. Flush the cache (Recipe 5) if you touched theme.json or any variation file.

This sequencing keeps the most important artifact safe even if a later step fails — the template's markup landed first.

#### Mandatory summary

After persistence, emit one line per artifact written. Examples:

```
wrote wp_template:single (id 42, 1289 bytes)
edited wp-content/themes/<themeSlug>/theme.json (extended styles.blocks.core/heading + settings.custom.hero)
wrote wp-content/themes/<themeSlug>/styles/blocks/neptune-callout-dark.json
flushed theme.json cache
```

No JSON envelope, no markdown fences around the markup, no narration around the summary.

### Hard rules for the markup itself

- Must start with `<!-- wp:` and have matching opening/closing block comments.
- Do NOT include `<html>`, `<head>`, or `<body>`.
- Do NOT include the React function signature, props types, imports, or any TS.
- Do NOT include the `const imgFoo = "http://localhost:3845/..."` declarations.
- Raw inline `style="..."` HTML attributes on rendered elements are FORBIDDEN — they break Gutenberg's block validation. Promote every value to theme.json or a registered variation.

### Hard rules for theme.json

The pull-writer Recipe 6 covers the mechanics. The shape rules:

- Only touch `styles.blocks["core/<x>"]` and `settings.custom`. Everything else is owned by the variables build and the theme scaffold.
- DEEP-MERGE into whatever's there. Read the current values first; your write extends rather than replaces.
- NEVER put a `variations` field under `styles.blocks["core/<x>"]`. Variations live in their own files (Recipe 7), and merging them into theme.json is a dead-write path.

### Hard rules for block style variations

The pull-writer Recipe 7 covers the mechanics. The shape rules:

- `slug` MUST start with `neptune-` (kebab-case). The class WP generates is `is-style-<slug>`; the prefix avoids collisions with theme defaults.
- `blockTypes` is a non-empty array of block names; one variation can apply to multiple blocks.
- `styles` is the theme.json `styles` shape — color / typography / spacing / border / elements / blocks / css. Settings, patterns, templates NOT allowed.
- Reuse an existing variation from `=== existing block style variations ===` when one matches — apply the `is-style-<slug>` class to the block, do not redeclare.

## Where to put style information

The default channel for styling a block is `theme_json_patch.blocks["core/<x>"]` — extending what's already in `theme.json.styles.blocks`. Per-instance styling lives in a `block_style_variations[]` entry the block claims via `is-style-<slug>`. Raw inline `style="..."` HTML attributes on the rendered HTML inside a block are FORBIDDEN — they break Gutenberg's block validation (the parser re-runs `save()` and rejects markup whose attributes don't match what `save()` would emit). Promote every value to a theme.json patch or a registered variation.

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
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties (color/typography/spacing/dimensions/border/shadow/outline/elements). DEFAULT channel for any value that isn't a preset slug. Read what's already at `theme.json.styles.blocks["core/<x>"]` first; your patch extends that subtree. Walk the cheat sheet above before deciding a value isn't structured.
3. **An existing block style variation** — if `=== existing block style variations ===` contains an entry whose `styles` already matches what you need, apply its `is-style-<slug>` class. Do NOT redeclare in `block_style_variations[]`.
4. **A new block style variation** in `block_style_variations[]` — register one whenever the same constellation of styles will (or already does) appear on multiple instances of the same block type with a coherent visual identity. Use structured properties inside `styles` first; only fall through to `styles.css` when the rule isn't structured (display/flex-direction, child-element selectors, media queries). Forcing question: "would I otherwise inline these same styles on a sibling block of the same type?" If yes, register the variation.
5. **The `layout` attribute on the block instance** — for flex / grid / constrained containers, set `wp:group`'s `layout:{...}` (see "Layout attribute" above). This is the right channel for `display:flex`, `justify-content`, `flex-wrap`, `grid-template-columns:repeat(N,1fr)`. Do NOT emulate these by writing CSS keyed off a custom `className`.
6. **CSS** in a `.css` field — only when the rule cannot be expressed as a structured property AND is not a `layout` choice (pseudo-selectors, child-element selectors, animations, complex states, media-query refinements). Use `theme_json_patch.blocks["core/<x>"].css` for project-wide rules or a variation's `styles.css` for scoped ones. Inside the `css` value, prefer `&{...}` (the block itself) and block-internal descendant selectors (`& img`, `& .wp-block-button__link`); a variation's own `&.is-style-<slug>{...}` selector is also fine. Avoid `&.<custom-class>{...}` selectors that depend on a `className` you invented for the purpose — those are the className-as-CSS-hook anti-pattern (see Hard rules).

There is NO step 7. Raw inline `style="..."` HTML attributes on the rendered HTML elements inside block markup are FORBIDDEN without exception — they cause Gutenberg block validation failures ("block contains unexpected or invalid content") because the saved HTML has to match what the block's `save()` function would emit, and `save()` derives styles from the block's structured JSON attributes (the comment), not from hand-written HTML attributes. If a value seems instance-specific enough to want an inline style, it belongs in a `block_style_variations[]` entry; promote it.

NEVER write to `styles.css` or any other top-level theme.json key. NEVER emit raw CSS outside `theme_json_patch.blocks.<x>.css` or a variation's `styles.css`. The site's `style.css` file is off-limits.

### Worked examples

**When to register a variation.** Three callout cards in a row, each rendered as `<a className="bg-zinc-900 text-white p-6 rounded-lg" href="…">…</a>`.

- Wrong: three `wp:button` blocks with inline `style="..."` HTML attrs (or instance-level `style:{...}` JSON) setting background/color/padding/border-radius. Same values, three places — and the inline HTML form fails block validation.
- Right: register one `neptune-callout` variation covering `color.background`, `color.text`, `spacing.padding`, `border.radius`. Apply `is-style-neptune-callout` on each button. Future siblings reuse the class.

**When to extend `theme_json_patch.blocks`.** A single `<h2 class="tracking-tight">` (letter-spacing −0.02em), no matching preset, no "callout" identity — just project-wide heading typography.

- Wrong: instance-level `{"style":{"typography":{"letterSpacing":"-0.02em"}}}` on this `wp:heading`, or a raw `style="letter-spacing:-0.02em"` HTML attribute. Future headings won't pick it up, and the raw HTML form breaks block validation.
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

When no preset matches, the default channel is `theme_json_patch.blocks["core/<x>"]` — extending the existing `theme.json.styles.blocks["core/<x>"]` subtree. If the value is instance-specific (would only apply on some occurrences of the block type), promote it to a `block_style_variations[]` entry and apply `is-style-<slug>` on the relevant blocks. Raw inline `style="..."` HTML attributes are NOT a fallback — they fail Gutenberg's block validator on parse.

When a class uses a CSS variable like `var(--eureka/contrast-1,#21201c)`, resolve via `theme.json` if there's a matching preset; otherwise look up the resolved value in `variables.json` and use that hex/length directly.

## Hard rules

- Every opening block comment must have a matching closing comment (`<!-- wp:foo --> ... <!-- /wp:foo -->`).
- JSON in block comment attributes must be valid: no trailing commas, no comments, double-quoted keys.
- NEVER emit a raw HTML `style="..."` attribute (including `style=""`) on the rendered HTML elements inside block markup. The block parser re-runs the block's `save()` function and rejects markup whose inline style attributes don't match what `save()` would emit, surfacing as "this block contains unexpected or invalid content" in the editor. Hand-written `style="..."` attributes never match. All styling MUST go through `theme_json_patch.blocks["core/<x>"]` or a `block_style_variations[]` entry the block claims via `is-style-<slug>`.
- Do NOT set instance-level `"style":{...}` JSON block attributes (e.g. `<!-- wp:group {"style":{"color":{"background":"#fff"}}} -->`). The save function would render a matching inline `style="..."` HTML attribute, and getting that exactly right is brittle. Promote project-wide values to `theme_json_patch.blocks["core/<x>"]` and per-instance values to `block_style_variations[]`. The only `"style":{...}` form that is safe at instance level is `"style":{"spacing":{"blockGap":"var:preset|spacing|<slug>"}}` on `wp:group` / `wp:columns` / `wp:cover` (the canonical pairing with a `layout:{...}` attribute).
- Strip Figma's `data-node-id`, `data-name`, `data-neptune-annotations`, and `data-development-annotations` attributes from the output — they have no value in WordPress. Both annotation kinds still inform the conversion (semantic block selection / designer intent); they just don't appear in the emitted markup.
- Slugs are kebab-case, lowercase, alphanumeric + hyphens.
- Variation slugs in `block_style_variations[]` MUST be prefixed `neptune-` so they don't collide with theme defaults.
- When adding a border to a single edge of a block, ensure other edges are explicitly set to `0px` to avoid unintended borders from theme styles.
- Do NOT invent project-specific `className` values whose only purpose is to give a CSS rule a selector. If you find yourself wanting to write `theme_json_patch.blocks["core/<x>"].css = "&.foo{...}"` to back a class you just made up, choose instead one of: (a) a `block_style_variations[]` entry the block claims via `is-style-<slug>` (CSS keyed off `&.is-style-<slug>` or `&` inside the variation is fine — the variation's class is registered, not invented per-template); (b) structured properties on the block (`style.spacing`, `style.dimensions`, `style.border`, `style.typography`, ...) plus a `layout:{...}` attribute when the rule is layout. The `metadata.name` field on a block (used for human-readable labels in the editor's list view) is NOT a styling hook and is fine. Block-internal child selectors inside a variation's or block's `css` field (`& img`, `& .wp-block-button__link`, `& > .wp-block-group`) are also fine — they don't depend on a custom `className`.
- For `wp:image` blocks: resolve the source against the `=== media library mappings ===` section. If the JSX `<img>`'s `src` references a const that appears in the mapped entries (the `<constName> → id=<n>, url=<...>` lines), use that entry's `id` and `url` (`"id":<id>` in attrs, `<img src="<url>" class="wp-image-<id>">`). If the const appears in the discarded entries (the `<constName>: <description>` lines) or is absent from the section entirely, do NOT emit a `wp:image` — see "Handling SVG and unmapped image references" below. Empty `wp:image` (`src=""` with no `id`) is forbidden: WP renders it as a broken-image placeholder. Never use Figma's local asset URLs (`http://localhost:3845/...`) and never invent file paths.
- Never wrap the response in markdown code fences.

## Self-check before responding

Throughout this skill the field names `theme_json_patch.blocks["core/<x>"]` and `block_style_variations[]` appear as mental shorthand for two on-disk destinations:

| Mental shorthand | Actual destination | Recipe |
|---|---|---|
| `theme_json_patch.blocks["core/<x>"]` | `theme.json`'s `styles.blocks["core/<x>"]` subtree | pull-writer Recipe 6 |
| `theme_json_patch.custom` | `theme.json`'s `settings.custom` subtree | pull-writer Recipe 6 |
| `block_style_variations[]` entry | one file at `styles/blocks/<slug>.json` | pull-writer Recipe 7 |

Read the rules below using the shorthand; the recipes own the mechanics of writing those locations.

1. Block markup persists via pull-writer Recipe 2 (template) or Recipe 4 (page/post content). Then theme.json edits (Recipe 6) if any. Then variation files (Recipe 7) if any. Then ONE cache flush (Recipe 5) if you touched theme.json or any variation file. Then a terse plaintext summary — one line per artifact, no JSON, no commentary.
2. Block markup starts with `<!-- wp:` and balances opening/closing block comments. JSON inside every block comment attribute parses.
3. theme.json edits ONLY touch `styles.blocks` and `settings.custom`. No `variations` field anywhere inside `styles.blocks["core/<x>"]` — variations live in their own files via Recipe 7.
4. Every block style variation file's slug starts with `neptune-` AND its `is-style-<slug>` class appears on at least one block in the markup. Every `is-style-neptune-<slug>` class on a block is backed EITHER by an existing-variations inventory entry OR a new `styles/blocks/<slug>.json` file — never both, never neither.
5. CSS only used when no pre-exposed structured property could express the rule. Specifically, before writing any of `aspect-ratio`, `min-height`, `gap`, `padding`, `margin`, `border-*`, `box-shadow`, `outline-*`, `font-*`, `letter-spacing`, `line-height`, `text-transform`, `background`, or `color` into a `css` field, verify the structured equivalent (`dimensions.aspectRatio`, `dimensions.minHeight`, `spacing.blockGap`, `spacing.padding`, `spacing.margin`, `border.*`, `shadow`, `outline.*`, `typography.*`, `color.*`) cannot be used.
6. Block markup contains zero raw HTML `style="..."` attributes (including empty `style=""`) and zero instance-level `"style":{...}` JSON block attributes — except the canonical `"style":{"spacing":{"blockGap":"var:preset|spacing|<slug>"}}` on layout containers. Every styling decision is realized via theme.json's `styles.blocks`, a variation file, or that one canonical instance-level shape.
7. Every flex / grid / constrained container uses the `layout` block attribute (`layout:{"type":"flex"|"grid"|"constrained",...}`) — NOT emulated via a custom `className` plus a CSS rule. Inter-child gap goes in `style.spacing.blockGap`, not a `gap:...` declaration in `css`.
8. No `wp:group` declares its own `contentSize` or `wideSize` under `layout` unless the section legitimately departs from project-wide widths (rare). Width is `align:"wide"` / `align:"full"` / no align, driven by `theme.json.settings.layout`. Narrower content uses `style.spacing.padding.left/right` (or a registered variation), not a custom `contentSize`.
9. Every `className` on a block is one of: `is-style-<slug>` (variation), a wp-core class (`alignwide`, `alignfull`, etc.), or a class explicitly required by the source TSX for behavior the agent is not free to drop. NO ad-hoc BEM-style handles whose sole job is to back `&.<name>{...}` rules. For every `&.<custom-class>{...}` selector that does appear in a `css` field, confirm `<custom-class>` is `is-style-<registered-slug>` — NOT a className you invented.
10. Every JSX call whose tag matches a `=== registered patterns ===` `name` was emitted as `<!-- wp:pattern {"slug":"<slug>"} /-->`, not inlined. Slug used verbatim.
11. No `function`, `import`, `const imgFoo`, or TypeScript syntax remains.
