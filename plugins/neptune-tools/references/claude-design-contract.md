# Claude Design package contract

Neptune's **Import Claude Design** command ingests a "Claude Design package": a
directory holding a near-final WordPress block theme plus the static design
references it was built from. This file is the contract — what Neptune requires,
what it expects, and the prompt to give Claude Design so partners produce a
predictable shape.

The example at `tomrhodes.blog` is one small package; real packages carry more
templates, more parts, and more references. **Nothing is keyed to specific
filenames** — Neptune enumerates whatever is on disk.

## Directory shape

```
<package>/
├── theme.json            REQUIRED — block theme v3 (settings + styles)
├── style.css             expected — one stylesheet keyed to --wp--preset--*
├── templates/*.html      REQUIRED (≥1) — Gutenberg block markup templates
├── parts/*.html          expected — block-markup template parts (any names)
├── assets/*              optional — *.js (behaviour), fonts, images
├── patterns/*.php|html   optional — theme block patterns
├── <name>.html           expected — top-level static reference per template
│                         (e.g. index.html ↔ templates/index.html); the
│                         refine diff target for that template
├── HANDOFF.md            optional — region→block map + custom-bits notes
└── (anything else)       ignored
```

### Hard requirements

- `theme.json` parses, is version 3 (v2 is accepted with a warning), and has a
  `settings` object.
- At least one file under `templates/` whose content is Gutenberg block markup
  (contains `<!-- wp:`). Files that aren't block markup are skipped with a warning.

### Expected (advisory if missing)

- A `style.css` written against `--wp--preset--*` variables. This is the input the
  standardize pass reclassifies; without it Neptune assumes `theme.json` already
  carries all styling.
- A top-level `<name>.html` static reference for each `templates/<name>.html`. A
  template without one is installed but can't be visually refined.
- `parts/<name>.html` for every template part the templates reference (also
  declared under `theme.json` `templateParts`).

## What Neptune does on import

1. **Validate** the package against this contract.
2. **Copy** theme.json, templates, parts, style.css, assets, and patterns into the
   active theme directory (the cloned Neptune starter that carries
   `functions.php` + `inc/class-neptune-cli.php`).
3. **Standardize + fact-check (auto-apply, maximize standards)** — run the
   `standardize-theme` skill: fold every `style.css` rule that can be expressed
   structurally into `theme.json` (`styles.elements` / `styles.blocks`) or a named
   block style variation, rewrite the markup to drop redundant classNames, and keep
   only the inexpressible rules (dark-mode toggle, CSS counters, pseudo/descendant
   selectors) as a trimmed residual `style.css`. Also validates block markup and
   audits theme.json completeness.
4. **Enqueue** the residual stylesheet, any `assets/*.js`, and the web fonts via a
   sentinel-bounded block in `functions.php`.
5. **Install** templates/parts into the WordPress database, seed Query Loop posts,
   and ensure pages for any `customTemplates`.
6. **Synthesize refine targets** — render each static reference to a screenshot and
   write a synthetic pull, so the existing visual-diff → apply-diff refine loop
   polishes the result.

Because standardization is auto-applied, the refine loop is the safety net: it
diffs the live render against the static reference and fixes any regression.

> Partners do **not** need to perfect `style.css` by hand — Neptune's standardize
> pass folds it into theme.json. The class-name bridge (blocks carry the
> reference's classes; `style.css` is keyed to `--wp--preset--*`) is still the
> right way to deliver, because it makes the imported theme render correctly
> *before* standardization and gives the pass clean hooks to reclassify.

---

## Prompt template (give this to Claude Design)

Fill the `[brackets]`. The deliverable structure below is the contract above.

> I have an **approved** design (attached / in this project: `[files or screenshots]`).
> Do **not** redesign it — reproduce it faithfully. Convert it into a **static
> reference + a head-start WordPress block theme** that an automated tool will
> finish.
>
> **Work in phases — do not build everything at once.**
> 1. **Inventory first.** Produce `INVENTORY.md`: every template, every template
>    part, every repeated component/pattern, and the token set. Wait for my OK.
> 2. **Vertical slice.** Build `theme.json` + `style.css` + **one** reference page
>    end to end to lock the system. Pause for confirmation.
> 3. **Fan out.** Build the remaining templates reusing the locked tokens, classes,
>    and shared parts — no new colours, fonts, or one-off CSS.
>
> **Design facts** (use exactly these): Fonts `[display / body / mono]`; Palette
> `[name: #hex]×N` plus any dark/alt mode; Layout `[e.g. 320px rail + fluid
> content; reading measure 640px]`; Templates `[index, single, …]`; Interactive
> bits `[e.g. paper/ink toggle persisted across pages]`.
>
> **Deliverables (this exact structure):**
> - `theme.json` (block theme, **version 3**) — palette slugs, `fontFamilies`, a
>   named `fontSize` scale, spacing, and `styles.elements.h1`–`h6` / links.
> - `style.css` — one stylesheet used by **both** the reference and the theme.
>   Write all rules against the variables WordPress generates from `theme.json`
>   (`--wp--preset--color--<slug>`, `--wp--preset--font-family--<slug>`,
>   `--wp--preset--font-size--<slug>`), with a `:root` fallback so the static
>   pages render standalone. Don't over-engineer it — an automated pass will fold
>   most of it into theme.json; just keep it correct and keyed to the presets.
> - `templates/*.html` + `parts/*.html` — block-markup scaffolds. **Every block
>   carries the same `className` as the reference markup.** Use core blocks (Query
>   Loop, Post Template, Post Title/Excerpt/Featured Image/Terms/Date/Author, Query
>   Pagination, Post Navigation, Comments, template parts). Mark each template-part
>   boundary and each dynamic value with a comment naming its WP source.
> - `<name>.html` for each template (`index.html`, `single.html`, …) — static,
>   responsive reference pages, the source of truth for *look*.
> - `assets/*.js` — any custom behaviour, vanilla, `localStorage`-persisted, with a
>   no-flash inline `<head>` snippet.
> - `HANDOFF.md` — a region→core-block table, the token map, a font-loading note,
>   and an explicit **"custom bits (not core blocks)"** list (loop index numbers →
>   CSS counter; reading time → plugin/snippet; custom controls → `core/html` +
>   enqueued JS) with how to implement each.
> - `INVENTORY.md` and a `style-guide.html` — the manifest and the visual index of
>   every reusable component (the canary for drift).
>
> **Acceptance:** static pages render with zero console errors; keeping `style.css`
> + the class names makes the rendered theme match the reference pixel-for-pixel;
> `theme.json` validates; responsive at ~390px. Each template lists its block map in
> `HANDOFF.md`, adds **zero** new tokens, and reuses existing classes/parts.

## Why the shape matters

- **The class-name bridge** (blocks carry the reference's classes; `style.css` is
  keyed to `--wp--preset--*`) makes the imported theme render correctly immediately
  and gives the standardize pass clean hooks to reclassify.
- **"Don't redesign"** pins the design as ground truth; the failure mode after a
  design phase is the model "improving" things.
- **The "custom bits" clause** forces honesty about core-block limits — exactly the
  rules Neptune keeps as residual CSS instead of dropping.
- **Naming the file tree** produces a tidy, enumerable structure instead of one big
  file.
