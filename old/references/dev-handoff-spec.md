# Neptune dev-handoff spec

This document lists every assumption the **Neptune** plugin makes about how a Figma dev-handoff page is structured. The plugin walks the dev-handoff page once during setup and extracts everything it needs to build the WordPress block theme; if any of these assumptions are violated, the corresponding pipeline stage either fails or produces lower-quality output.

## How to use this document

1. **Designer:** read each item, confirm whether the design will follow the convention, and write a response in the **Designer response** column or notes area. Use one of:
   - `OK` — confirmed, will follow as written.
   - `OK with note: <…>` — will follow, but with a caveat the developer should know about.
   - `Won't follow because <…>` — push back; needs developer discussion before proceeding.
2. **Developer:** review the responses, capture any deviations as known constraints, and adjust the Neptune skill prompts if a deviation is intentional and reusable across projects.

Each item is marked with a level:

- **R** = Required. Neptune fails or produces empty output if violated.
- **r** = Recommended. Neptune recovers but downstream output quality degrades.
- **Match: Exact** = the string is matched character-for-character (including emoji); a rename will silently break the pipeline.

---

## 1. The dev-handoff page itself

| ID  | Assumption                                                                                                                       | Level | Designer response |
| --- | ---                                                                                                                              | ---   | ---               |
| 1.1 | A single Figma file page exists that is the "dev handoff" — the source of truth for templates, styles, and notes.                | R     |                   |
| 1.2 | The user can right-click the **page tab** (not the canvas) and "Copy link to selection" to get a URL with a `node-id` parameter. | R     |                   |
| 1.3 | The official Figma MCP (`mcp__figma__*`) is connected in the Claude Code session; the file is addressable by `figmaFileId` + node ID. | R     |                   |
| 1.4 | If multiple dated dev-handoff pages exist (e.g. "Dev Handoff — Nov 10, 2025"), the user picks one URL — Neptune doesn't auto-resolve "latest". | r |                   |

---

## 2. Required sections on the dev-handoff page

These two section names are matched **literally** including emoji and spacing. Renaming either silently breaks the corresponding pipeline stage.

| ID  | Section name (exact)   | Purpose                                           | Level | Match | Designer response |
| --- | ---                    | ---                                               | ---   | ---   | ---               |
| 2.1 | `🗒️ Templates`         | Holds Title Cards + their layout frames           | R     | Exact |                   |
| 2.2 | `🎨 Style Guide`       | Visual rendering of palette, typography, spacing  | R     | Exact |                   |

> **Designer notes (Section 2):**
>
> _

---

## 3. Templates section (`🗒️ Templates`)

### 3a. Title Cards

| ID  | Assumption                                                                                              | Level | Match | Designer response |
| --- | ---                                                                                                     | ---   | ---   | ---               |
| 3.1 | Each design template has a **frame named exactly `Title Card`** within the Templates section.           | R     | Exact |                   |
| 3.2 | Each Title Card frame has **exactly one `<text>` child**, whose **layer name** is the visible title.    | R     | —     |                   |
| 3.3 | The Title Card's text-layer name (e.g. `Front Page`, `Blog Post`) is the canonical name Neptune writes into `templateMappings`. The text content itself can be styled/wrapped freely; only the layer name matters. | R | — |  |
| 3.4 | One Title Card per design. Don't reuse a single Title Card for multiple layouts.                        | R     | —     |                   |
| 3.5 | Title Cards sit **visually above** their associated layout frames (lower y-coordinate).                 | R     | —     |                   |

### 3b. Layout frames (the actual designs)

| ID   | Assumption                                                                                              | Level | Designer response |
| ---  | ---                                                                                                     | ---   | ---               |
| 3.6  | Each layout is a **frame or instance** placed inside the Templates section.                             | R     |                   |
| 3.7  | A layout's **horizontal centre** falls within its Title Card's **horizontal range** (so the title visually "labels" the column). Non-aligned layouts trigger a "weak match" warning and may pair incorrectly. | R |  |
| 3.8  | Layout **widths bucket-detect** by standard breakpoint anchors: `desktop` ≥ 1024, `tablet` 600–1023, `mobile` < 600. Any 1280 desktop / 768 tablet / 375 mobile is fine. | R |  |
| 3.9  | If a single design has two layouts in the **same** breakpoint bucket (e.g. 1280 + 1440 both ≥ 1024), the wider becomes `desktop` and the narrower is flagged as `desktop-alt` for the user to disambiguate. | r |  |
| 3.10 | Layout frame **names are not used for pairing**. Title Card pairs with layout via spatial position only. Designers can use any frame names — Neptune uses the Title Card's text as the canonical name regardless. | r |  |
| 3.11 | A header / footer **does NOT need its own Title Card**. Header and footer regions are extracted from inside the page templates at build time. (Designers can still add Title Cards for header/footer if they want explicit mapping.) | r |  |

> **Designer notes (Section 3):**
>
> _

---

## 4. Style Guide section (`🎨 Style Guide`)

| ID  | Assumption                                                                                              | Level | Designer response |
| --- | ---                                                                                                     | ---   | ---               |
| 4.1 | All design tokens — **palette colors, typography styles, spacing scale** — are defined as **Figma variables**. Hex values painted directly without a variable will appear as raw `#xxxxxx` literals in produced markup, not as theme.json palette slugs. | R |  |
| 4.2 | The Style Guide section visually renders the variables (so `theme-json` can cross-reference what's actually used).                  | r |  |

### 4a. Variable naming conventions

These are the patterns Neptune translates into `theme.json`. Stick to them and tokens flow into WordPress automatically; deviate and tokens fall back to literal hex/px values.

| ID  | Token type                | Path format                                | Example                          | Becomes (theme.json slug)        | Designer response |
| --- | ---                       | ---                                        | ---                              | ---                              | ---               |
| 4.4 | Color                     | `<scope>/<name-or-step>`                   | `eureka/contrast-1`              | palette slug `eureka-contrast-1` |                   |
| 4.5 | Spacing                   | `<breakpoint>/<step-or-name>`              | `desktop/5`, `mobile/body-margin`| spacingSizes slug `desktop-5`    |                   |
| 4.6 | Typography (composite)    | `<breakpoint>/Sizes/<variant>`             | `Mobile/Sizes/Normal`            | typography preset                |                   |
| 4.7 | Token paths use `/` as separator; theme.json slugs replace `/` with `-`. Avoid characters that aren't valid in CSS custom-property names. | — | — | — |  |

> **Designer notes (Section 4):**
>
> _

---

## 5. Dev Notes (`💬 Dev Note`)

| ID  | Assumption                                                                                              | Level | Match | Designer response |
| --- | ---                                                                                                     | ---   | ---   | ---               |
| 5.1 | A reusable component named exactly `💬 Dev Note` exists (or instances whose names start with that string). | R | Exact |                   |
| 5.2 | Notes are placed as **instances** anywhere on the dev-handoff page. They can sit inside the Templates section, near layouts, anywhere visible. | R | — |  |
| 5.3 | Each note's visible text is the **overridden text** on the instance (not the master component's default). Neptune reads overrides through a single `use_figma` JS call scoped to the dev-handoff page, so the `figma:figma-use` skill must be available. | R | — |  |
| 5.4 | A Dev Note's `context` is its **enclosing layout / title-card** (walked via the parent chain), plus any element it overlaps or its Figma connector arrow points at. Notes sitting alone in the gutter without a connector or overlap inherit the nearest enclosing layout from their parent chain. | r | — |  |

> **Designer notes (Section 5):**
>
> _

---

## 6. Asset / image layer naming

The single most impactful designer-side discipline. Neptune triages every exported asset URL into "shape primitive" (render in CSS) vs "real content" (upload to media library) **based on the Figma layer name**. Sloppy naming → bad imports.

### 6a. Layer names that mean "shape primitive — don't upload"

Neptune treats these as renderable in WordPress block markup directly. Don't rename them to descriptive names just because they look important — they're decorative, not content.

| Pattern                                                  | Becomes                                            |
| ---                                                      | ---                                                |
| `Vector`, `Vector 1`, `Vector 69` (Figma's defaults)     | Inferred from geometry: shape, line, gradient      |
| `Rectangle`, `Rectangle N`                               | Background colour or `wp:separator`                |
| `Ellipse`, `Ellipse N`                                   | Border-radius on a group                           |
| `Line`, `Line N`                                         | `wp:separator`                                     |
| `Frame N`, `Group N`                                     | Layout container, ignored as asset                 |

### 6b. Layer names that mean "real content — upload to media library"

| Pattern                                            | Becomes                       |
| ---                                                | ---                           |
| `Image`, `Photo`, `<descriptive name>`             | PNG/JPG upload (`wp:image`)   |
| `Logo`, `Wordmark`, `Brandmark`                    | SVG upload                    |
| `Social Icons`, `Instagram`, `Facebook`, etc.      | SVG upload                    |
| `Icon ...`, `Arrow ...`, `Chevron ...`, `Check`    | SVG upload                    |
| `Avatar`, `Portrait`                               | PNG/JPG upload                |
| `Illustration`                                     | SVG/PNG upload                |

### 6c. Designer guidelines

| ID  | Guideline                                                                                                                                                  | Designer response |
| --- | ---                                                                                                                                                        | ---               |
| 6.1 | **Rename intentional content layers.** A logo SVG named `Vector` will be inferred as a shape primitive and rendered as CSS — wrong.                        |                   |
| 6.2 | **Don't rename shape primitives.** A divider line renamed to `Hero Divider` will be uploaded to the media library — bloat.                                 |                   |
| 6.3 | Use **alt-text-friendly names** for content images. The layer name becomes the WordPress attachment's `alt` attribute (e.g. `Newsletter Icon` → alt text "Newsletter Icon"). |                   |
| 6.4 | Group multi-path icons into a single component. Otherwise Figma exports each path as a separate `Vector` constant and Neptune can't tell they belong together. |                   |

> **Designer notes (Section 6):**
>
> _

---

## 7. Site-level brand assets (favicon, screenshot, sharecard)

Neptune extracts site-level brand assets **from inside the page designs at build time** — not from a dedicated section. Place each one inside whichever page design naturally contains it (e.g. the favicon and sharecard typically appear inside header / front-page designs; the theme screenshot is auto-generated from the rendered front page during build).

| ID  | Assumption                                                                                              | Level | Designer response |
| --- | ---                                                                                                     | ---   | ---               |
| 7.1 | The browser-tab favicon, when present in the design, lives inside the relevant page design (e.g. inside the header layer of `Front Page`). Layer name: `Site Icon`, `Favicon`, or similar — descriptive enough that asset triage in Section 6b imports it. | r |  |
| 7.2 | The social-sharing card (og:image), when present, lives inside the relevant page design — layer name should make it identifiable (e.g. `Social Sharecard`, `OG Image`). | r |  |
| 7.3 | The theme thumbnail (`screenshot.png` shown in the WordPress theme picker) does **not** need to be designed separately. Neptune auto-generates it from the rendered front page during build. | r |  |

> **Designer notes (Section 7):**
>
> _

---

## 8. Known limitations to flag with the designer

These aren't assumptions Neptune *makes*, but constraints designers should know about so they don't produce designs Neptune can't handle.

| ID  | Limitation                                                                                                                                                                                                              | Designer response |
| --- | ---                                                                                                                                                                                                                     | ---               |
| 8.1 | **No multi-mode variables.** Figma variables with light/dark modes are read in their default mode only. Dark-mode theming needs to be authored separately (or done post-build by a developer).                          |                   |
| 8.2 | **No animations or interactions.** Hover states, transitions, prototypes — all ignored. Designs should specify final rendered state only.                                                                                |                   |
| 8.3 | **No responsive variants beyond standard breakpoints.** `desktop` / `tablet` / `mobile` are the bucket anchors; intermediate breakpoints (e.g. a "wide-desktop" at 1920) get folded into `desktop` and surfaced as `desktop-alt` for user choice. |                   |
| 8.4 | **One title card per visual concept.** Multiple title cards with the same text (e.g. two "Blog" cards for A/B variants) collide on `templateMappings` keys. Use distinct titles ("Blog A", "Blog B").                     |                   |
| 8.5 | **Hex colours painted without a variable** become inline `#xxxxxx` in produced markup, not theme.json palette references. Always paint via a Figma variable when consistency matters.                                    |                   |
| 8.6 | **Figma plugin-rendered content is unsupported.** If a layer's contents are produced by a plugin (e.g. iconify, Lorem Ipsum generators) the produced output isn't represented in the MCP's `get_design_context` response. |                   |

> **Designer notes (Section 8):**
>
> _

---

## Priority confirmations

If only the top 5 items below are confirmed, Neptune will work end-to-end on first run. Everything else is recoverable or surfaces warnings.

1. **2.1 / 2.2** — Section names use exact emoji and capitalisation as listed.
2. **3.1 / 3.2** — Title Card naming and the single-text-child rule.
3. **4.1 / 4.4 / 4.5 / 4.6** — Tokens are defined as Figma variables with the named-path conventions.
4. **5.1** — `💬 Dev Note` component name is exact.
5. **6.1 / 6.2** — Asset layer naming discipline.

---

## Sign-off

| Field                                  | Value |
| ---                                    | ---   |
| Project / Figma file                   |       |
| Designer name                          |       |
| Date reviewed                          |       |
| Outstanding items needing developer discussion | (list any IDs marked "Won't follow because…") |
