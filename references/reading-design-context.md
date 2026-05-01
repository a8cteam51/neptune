# Reading get_design_context output

`mcp__figma__get_design_context` returns React + Tailwind code, design tokens, font definitions, and asset URLs. **Treat the React component as a structural blueprint, not literal code to convert.** Figma's MCP ships React+Tailwind as a structural reference — your job is to read it as a tree of layout intents, design-token references, and content slots, and emit the equivalent WordPress block markup directly. Do not translate React → HTML+CSS → WP block markup; go straight from blueprint to blocks.

## Translation contract

**Hierarchy.** Each `<div>` in the JSX tree is one frame in Figma. Mirror the nesting in your block tree — usually `wp:group` for a single child stack, `wp:columns` + `wp:column` for horizontal multi-child layouts, `wp:cover` when a frame has a background image with overlaid content.

**Layout primitives.** Read Tailwind utilities for layout intent, then emit the equivalent block layout:

| Tailwind                              | Block-markup equivalent                                                          |
| ---                                   | ---                                                                              |
| `flex flex-col`                       | `wp:group` with `layout: { type: "flex", orientation: "vertical" }`              |
| `flex` (row default)                  | `wp:group` with `layout: { type: "flex", orientation: "horizontal" }`            |
| `grid grid-cols-<N>`                  | `wp:columns` with `<N>` `wp:column` children                                     |
| `gap-[<v>]` or `gap-[var(--…,<v>)]`   | `style.spacing.blockGap` on the parent group                                     |
| `p-[<v>]`, `px-[…]`, `py-[…]`         | `style.spacing.padding` on the parent (top/right/bottom/left)                    |
| `w-[<v>]`, `max-w-[<v>]`              | `style.dimensions.width` / `maxWidth`                                            |
| `items-*` / `justify-*`               | `layout.justifyContent` / `layout.verticalAlignment` on flex groups              |
| `text-[<v>]`, `font-['<family>:…']`   | typography preset (see Tokens below)                                             |
| `text-[color:var(--…,<hex>)]`         | `style.color.text` resolving through `theme.json` palette                        |
| `bg-[var(--…,<hex>)]`                 | `style.color.background` resolving through `theme.json` palette                  |
| `border-[var(--…,<hex>)]`             | `style.border.color` resolving through `theme.json`                              |

**Tokens.** Tailwind classes embed CSS variables in the form `var(--<token-path>,<fallback>)`. Read the token path first; map it to the `theme.json` preset whose slug matches (replacing `/` with `-` in the token path). If no matching preset exists, fall back to the inline numeric or color value. Examples:

- `bg-[var(--eureka\/contrast-1,#21201c)]` → token path `eureka/contrast-1` → `theme.json` palette slug `eureka-contrast-1` → `style.color.background = "var:preset|color|eureka-contrast-1"`. Fallback if missing: literal `#21201c`.
- `gap-[var(--desktop\/5,24px)]` → token path `desktop/5` → `theme.json` `spacingSizes` slug `desktop-5` → `style.spacing.blockGap = "var:preset|spacing|desktop-5"`. Fallback: `24px`.
- `text-[20px] leading-[1.33]` with no token → emit literal values via `style.typography.fontSize` and `lineHeight`.

If you find tokens in the JSX that do **not** appear in `theme.json`, surface them in the run summary so the user knows the design uses tokens not yet captured by the `theme-json` skill — do not silently fall back to inline values for whole regions.

**Variants.** Components in the JSX often carry variant logic — `screenSize === "Mobile"`, `style === "Black"`, conditionals like `isBlackAndMobile`. Only translate the subtree that matches the variant for the breakpoint you're currently emitting (the `desktop` node from `templateMappings[…].figmaNodes` if you're building the desktop wrapper, the `mobile` node otherwise). Don't try to encode the variant logic in block markup — pick one branch per build call.

## Assets

Top-of-file constants like `const imgVector = "<asset-url>"` reference SVGs and PNGs the Figma MCP exports for the frame. Whatever the URL form, **never** ship those URLs through to produced block markup — they're transient export references, not stable site assets. **And not every asset constant should be uploaded** — Figma exports both real content (icons, photos, logos) and shape primitives (rectangles, lines, gradient fills, decorative paths) as constants. Triage each constant before deciding what to do with it.

### Triage: shape primitive vs. real content

The variable name is the primary signal. Figma names exported constants from the **Figma layer name** of the source vector — designers who name layers intentionally produce intentional names; layers left at Figma's defaults produce generic names.

**Generic names → almost always shape primitives. Render in WP blocks/CSS, do not import.**

| Variable name pattern              | Likely source                                     | WP equivalent                                                                |
| ---                                | ---                                               | ---                                                                          |
| `imgVector*`, `imgVector69`        | Unnamed vector path (Figma default name)          | Inspect parent + geometry — usually shape, line, or gradient (see below)     |
| `imgRectangle*`                    | A rectangle shape primitive                       | `wp:group` with `style.background.backgroundColor` or `wp:separator`         |
| `imgEllipse*`                      | A circle/oval                                     | `wp:group` with `border-radius: 50%` via block style                         |
| `imgLine*`                         | A line                                            | `wp:separator` (horizontal) or `wp:group` with `border-top` / `border-left`  |
| `imgFrame*`, `imgGroup*`           | Unnamed container                                 | Almost certainly a layout container, not an asset — ignore                   |

**Descriptive names → real content. Upload via `wp media import`.**

| Variable name pattern                                     | Likely source                                  | Action                                              |
| ---                                                       | ---                                            | ---                                                 |
| `imgImage*`, `imgPhoto*`                                  | Photographic raster                            | Upload (PNG/JPG)                                    |
| `imgLogo*`, `imgWordmark*`, `imgBrandmark*`               | Brand mark                                     | Upload (SVG)                                        |
| `imgSocialIcons*`, `imgInstagram`, `imgFacebook` etc.     | Platform icons                                 | Upload (SVG)                                        |
| `imgIcon*`, `imgArrow*`, `imgChevron*`, `imgCheck` etc.   | UI icons                                       | Upload (SVG)                                        |
| `imgAvatar*`, `imgPortrait*`                              | Portrait/avatar                                | Upload (PNG/JPG)                                    |
| `imgIllustration*`                                        | Custom illustration                            | Upload (SVG or PNG depending on source)             |

**Tie-breaker for ambiguous cases.** If the variable name doesn't fall into either bucket, look at the parent layer:

1. Get the variable's `data-node-id` reference from the JSX. Most asset `<img>` tags appear next to a `data-node-id` attribute on the wrapping div.
2. Call `mcp__figma__get_metadata` on that node ID and read its `name` attribute (and the parent's name, if needed). If the name is descriptive (`Footer Logo`, `Hero Image`, `Newsletter Icon`), treat as content. If it's generic (`Vector`, `Group 17`, `Frame 51076674`), treat as a shape primitive.
3. Check geometry. A `<img>` rendered into a parent box that's <= 64×64px is almost always an icon. A `<img>` rendered into a full-width container at the top of a section is almost always content. Boxes with width = container, height ≤ 4px are dividers (`wp:separator`).

### Shape primitives → WP block / CSS equivalents

When an asset is a shape primitive, **do not upload it** — express it natively. Common patterns:

| What the JSX shows                                                                                       | Render as                                                                                          |
| ---                                                                                                      | ---                                                                                                |
| `<img src={imgVector}/>` filling a container with a single fill colour                                   | Parent's `style.color.background` (use `theme.json` palette slug, see Tokens)                      |
| Thin horizontal `imgVector` (height ≤ 4px, width spans parent)                                           | `wp:separator` with the appropriate colour and thickness                                           |
| Thin vertical `imgVector` (width ≤ 4px, height spans parent)                                             | `wp:group` with `border-left` via block style                                                      |
| `imgVector` filling a container with `border-radius: 9999px` Tailwind class                              | `wp:group` with the same border-radius                                                             |
| Multiple `imgVector` constants stacked in a parent with `bg-gradient-to-*` Tailwind utility              | `wp:group` with `style.background.gradient` (resolve through `theme.json` `gradients` if matched)  |
| `imgVector` set as a Tailwind background image (`bg-[url(...)]`)                                         | `wp:cover` or `wp:group` with `style.background.backgroundImage` — but only if it isn't a shape    |

If you can't decisively classify an asset as either shape primitive or real content after these checks, **open a GitHub issue** per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` listing the asset URL and the parent node ID, and reference the issue URL in the run summary. Do not list the asset inline as a "needs human review" bullet without a backing issue. Do not silently import — bad imports pollute the media library and are tedious to clean up.

### Importing real content

For each asset triaged as real content:

1. Pick a stable filename. Derive from the Figma layer name where possible (`Newsletter Icon` → `newsletter-icon.svg`); fall back to the asset hash if the layer is unnamed (which by definition shouldn't happen for content — generic names should have been filtered out at triage).

2. Import via WP CLI. `studio wp media import` accepts URLs directly — it downloads the file, sideloads it, and returns the attachment ID via `--porcelain`. Pass alt text derived from the Figma layer name, and (during `/build-content`) a `--post_id` so the attachment is associated with the post being filled:

   ```bash
   ALT="<alt-text-from-figma-layer-name>"
   ATTACHMENT_ID=$(studio wp media import "<figma-asset-url>" \
     --porcelain \
     --alt="$ALT" \
     [--post_id=<post-id>])
   ATTACHMENT_URL=$(studio wp eval "echo wp_get_attachment_url($ATTACHMENT_ID);")
   ```

   Hold both values — they go into the block markup.

3. Reference the attachment from `wp:image` blocks by ID and URL. The block's JSON attributes carry the `id`; the `<img>` carries the full `src` URL and the `wp-image-<id>` class:

   ```html
   <!-- wp:image {"id":<ATTACHMENT_ID>,"sizeSlug":"full","linkDestination":"none"} -->
   <figure class="wp-block-image size-full"><img src="<ATTACHMENT_URL>" alt="<alt-text>" class="wp-image-<ATTACHMENT_ID>"/></figure>
   <!-- /wp:image -->
   ```

   Validate the produced markup via `mcp__wordpress-studio__validate_blocks` as usual.

4. **De-duplicate within a run.** The same asset hash often appears multiple times in a single `get_design_context` response (e.g. an icon used by every card in a list). Import each unique URL once per run, keep a map from asset URL → attachment ID, and reuse the ID across every block that needs it. This avoids piling duplicates into the media library on every build.

5. **SVG note.** Team 51 sites ship `safe-svg` activated, so SVG uploads are allowed out of the box. If an SVG import still fails (e.g. malformed source), surface it in the run summary and open a GitHub issue. Never substitute the original Figma export URL — those URLs are transient and will break once the Figma MCP rotates them.

**Node IDs.** `data-node-id="5860:7051"` attributes are traceability aids for `/refine-*` later. Discard them when emitting production block markup — they are not output.

**What to ignore.** Tailwind specificity workarounds (`shrink-0`, `relative`, `min-w-px`, `flex-[1_0_0]`, `content-stretch`) are React/Tailwind compiler artefacts with no block-markup equivalent. The same goes for the outer React component wrapper, `type FooterProps = …`, default-prop assignments, and conditional rendering scaffolding. Translate the JSX tree, not the framework around it.
