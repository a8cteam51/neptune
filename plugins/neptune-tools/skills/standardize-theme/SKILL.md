---
name: standardize-theme
description: Use when fact-checking and standardizing a near-final WordPress block theme — typically a Claude Design package whose styling lives in a hand-written style.css keyed to --wp--preset--* variables. Folds every style.css rule that can be expressed structurally into theme.json (styles.elements / styles.blocks) or a named block style variation, rewrites the block markup to drop the now-redundant classNames (or swap them for is-style-<slug>), and returns the residual CSS that genuinely cannot be expressed. Output is a strict JSON envelope; Neptune validates and persists it.
---

# Standardize a block theme into WordPress conventions

You are given a WordPress block theme that is already close to final: a complete `theme.json`, real Gutenberg block markup (templates and parts), and a large hand-written `style.css` written against `--wp--preset--*` CSS variables. The theme renders correctly, but it leans on the LEAST standards-driven option — a stylesheet full of semantic class hooks (`.eyebrow`, `.tag`, `.count`, `.idx-row`, …). Your job is to **maximize standards**: move everything that WordPress can express structurally OUT of `style.css` and INTO `theme.json` / block style variations, rewrite the markup accordingly, and leave only the genuinely inexpressible rules behind.

Do NOT assume the input is perfect. It is a draft to improve.

## Operating mode

This skill is a single-shot prompt → JSON transform. Do NOT call any tools — no Agent / Task subagent dispatch, no Read / Write / Edit / Bash, no MCP. Neptune validates and persists the JSON envelope itself. The only valid output is the JSON object described under "Output format".

## Inputs the user gives you

- `=== theme.json (current) ===` — the active theme's settings AND styles. The single source of truth for what's already registered (color palette, font families/sizes, spacing, `styles.elements`, `styles.blocks`). Read it before patching so you EXTEND rather than duplicate.
- `=== style.css (reclassify this) ===` — the hand-written stylesheet. This is your primary input: classify every rule.
- `=== existing block style variations ===` — (optional) JSON array of variations already registered. Reuse a matching one via its `is-style-<slug>` class instead of redeclaring.
- One `=== markup: <path> ===` section per template/part (e.g. `markup: templates/index.html`, `markup: parts/footer.html`). This is the block markup you rewrite. Echo every file you change back under `files` keyed by the EXACT same path.

## What to do with each style.css rule

Walk the priority order top-down and stop at the first option that fits. This mirrors Neptune's styling ladder.

1. **A theme.json preset already covers it** — if a rule just re-states a value that maps to an existing palette / fontSize / spacing preset, drop the rule and let the block reference the preset (`{"backgroundColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`).
2. **An element style** — rules targeting an HTML element broadly (headings `h1`–`h6`, `a`/links, `button`, lists, `blockquote`, `code`) belong in `theme_json_patch.elements.<element>`. Example: `.prose h2 { letter-spacing: -.02em }` that is really "all h2" → `elements.h2.typography.letterSpacing`. Extend, don't overwrite, what `theme.json.styles.elements` already has.
3. **A block-type style** — rules that apply to every instance of a core block (every `core/post-terms`, every `core/separator`) belong in `theme_json_patch.blocks["core/<x>"]` as structured properties (color/typography/spacing/border).
4. **A named block style variation** — a recurring, coherent "look" applied to multiple instances of a block type that deserves an editor-pickable name. Register it in `block_style_variations[]` and add its `is-style-<slug>` class to each block in the markup, removing the original class. Slugs MUST be kebab-case and `neptune-` prefixed. **Be aggressive here — this is where "maximize standards" is won.** A class whose declarations are plain typography / color / spacing / border (a "text atom" or "badge") is a variation, not residual CSS. Concrete examples you are EXPECTED to convert, not leave behind: an `.eyebrow` (small uppercase tracked label → `core/heading` variation), a `.mono` (monospace text → variation), a `.count`/`.badge` (pill counter), a `.tag`/pill, a `.rule`/divider (`core/separator`). If after the pass a class still carries flat `font-*`/`color`/`background`/`letter-spacing`/`text-transform`/`border-radius` declarations in `residual_css`, you did not finish — fold it into a variation. Only the genuinely structural part of such a rule (display/flex alignment, an inset ring `box-shadow`, whitespace) stays as residual CSS scoped to the `is-style-<slug>` class.
5. **A per-instance value** — a one-off on a single block goes in that block's `"style":{...}` JSON attribute in the block comment (NOT a raw HTML `style=""`).
6. **Residual CSS** — only when none of the above can express it. Return it in `residual_css`.

### What MUST stay in `residual_css`

Some rules have no theme.json equivalent. Keep them — never drop them:

- **Runtime theme toggles** — `html[data-theme="..."] { … }` dark-mode overrides. theme.json has no runtime switch.
- **CSS counters** — `counter-reset` / `counter-increment` and `::before { content: counter(...) }` (e.g. the `01.` post numbers).
- **Pseudo-elements / pseudo-classes** — `::before`, `::after`, `:hover`, `:focus-within`, `:nth-child`.
- **Descendant / sibling / attribute selectors** that target relationships structured properties can't reach (`.a .b`, `.a > .b`, `.a + .b`).
- **`@media` / `@supports` / `@keyframes`** and animations.
- **Layout scaffolding** that isn't a block property (CSS grid `grid-template-columns`/`grid-area` placement on a custom container).

`residual_css` is written to an auxiliary design stylesheet enqueued after the theme's own `style.css` — it is NOT the theme's `style.css`, so it needs no `Theme Name` header. Drop any `/*! Theme Name: … */` header block from the input; keep only the actual rules (a short `/* … */` note is fine).

### Class hooks the markup still needs

When a className is referenced ONLY by a residual rule (e.g. `.idx-num` used by a counter, `.pane-rail` used by grid placement), KEEP that className on the block. When a className's rules were fully reclassified into theme.json/variations, REMOVE it from the markup (or replace it with the variation's `is-style-<slug>`). Never leave a dead className whose styling moved.

## Fact-check while you standardize

- **theme.json completeness** — if `style.css` references a `--wp--preset--…` variable that has no matching entry in `theme.json` (a color/size used but never registered), add the missing preset under the right `settings` group via… you can't (settings is off-limits) — instead record it in `reclassified` with `to: "MISSING_PRESET"` and a note so Neptune can surface it. Do the same for obviously duplicated tokens.
- **Markup validity** — while rewriting, fix anything that would fail block validation: a raw HTML `style="..."` attribute on rendered HTML inside a block (promote it to the block comment's `"style":{...}` JSON), a stray className left after reclassification, or a malformed block comment. Do not restructure valid blocks.
- **Strip non-block HTML comments** — Claude Design markup carries annotation comments like `<!-- THE LOOP -->`, `<!-- THEME SWITCH -->`, `<!-- reading time… -->`. These are NOT Gutenberg block delimiters and the block parser treats them as freeform/invalid content. REMOVE every HTML comment from the markup you return EXCEPT genuine block delimiters (`<!-- wp:… -->`, `<!-- wp:… /-->`, `<!-- /wp:… -->`). Do not add any new comments of your own.
- Do NOT invent new design decisions. Re-express existing styling; don't add styling that wasn't there.

## Output format

Return ONLY a single JSON object. No markdown fences. No prose. Shape:

```jsonc
{
  "files": {
    "templates/index.html": "<!-- wp:group ... --> ... <!-- /wp:group -->",
    "parts/footer.html": "<!-- wp:group ... --> ... <!-- /wp:group -->"
  },
  "theme_json_patch": {
    "elements": {
      "h2": {"typography": {"letterSpacing": "-0.024em"}}
    },
    "blocks": {
      "core/post-terms": {"typography": {"fontFamily": "var:preset|font-family|mono"}}
    }
  },
  "block_style_variations": [
    {
      "slug": "neptune-tag",
      "title": "Tag",
      "blockTypes": ["core/post-terms"],
      "styles": {
        "spacing": {"padding": {"top": "2px", "right": "7px", "bottom": "2px", "left": "7px"}},
        "border": {"radius": "2px"},
        "color": {"background": "var(--wp--preset--color--ink)", "text": "var(--wp--preset--color--paper)"}
      }
    }
  ],
  "residual_css": "/* dark mode + counters — not expressible in theme.json */\nhtml[data-theme=\"ink\"]{--wp--preset--color--paper:#1A1A16}\n.idx-num::before{content:counter(idx,decimal-leading-zero)}",
  "reclassified": [
    {"from": ".tag", "to": "block_style_variations:neptune-tag", "note": "pill applied to post-terms"},
    {"from": "h1..h6 sizing", "to": "theme_json_patch.elements", "note": "moved to styles.elements"}
  ],
  "kept": [
    {"rule": "html[data-theme=ink]", "reason": "runtime toggle"},
    {"rule": ".idx-num::before counter", "reason": "CSS counter, no theme.json equivalent"}
  ]
}
```

### Field rules

- `files`: only the templates/parts you actually rewrote, each keyed by its exact input path. Each value is the COMPLETE replacement markup, starting with `<!-- wp:` and with balanced block comments. Omit files you didn't change.
- `theme_json_patch` (optional): only `elements`, `blocks`, and/or `custom` at the top level. Neptune deep-merges these into `theme.json`'s `styles.elements`, `styles.blocks`, and `settings.custom`. Do NOT touch `settings` presets, `templateParts`, `customTemplates`, `version`, or top-level `styles.color`/`styles.typography`. Do NOT put `variations` under `blocks.<x>` — those go in `block_style_variations`.
- `block_style_variations` (optional): editor-pickable variations. Each entry → `<theme>/styles/blocks/<slug>.json`. Required keys: `slug` (kebab-case, MUST start with `neptune-`), `title`, `blockTypes` (non-empty `core/x`/`vendor/x` array), `styles` (theme.json `styles` shape). Every entry's `is-style-<slug>` class MUST appear on a block in some `files` entry.
- `residual_css`: the trimmed stylesheet — only the inexpressible rules. Return an empty string `""` when you reclassified the ENTIRE stylesheet and nothing remains. Omit the key entirely ONLY if you left the stylesheet untouched (no reclassification at all). If you are not confident a rule is expressible, KEEP it here rather than dropping it. (Neptune writes the empty string out so the original full stylesheet stops being applied; omitting the key keeps the original.)
- `reclassified` / `kept`: short human-readable report objects. Not persisted to WordPress; used for the Neptune UI summary. Include `MISSING_PRESET` / duplicate-token findings in `reclassified`.

## Rules

- Maximize standards, but NEVER change the rendered design. Every value you move must resolve to the same computed style.
- Refinement, not rewrite. Markup regions whose classNames you didn't reclassify stay byte-for-byte the same (modulo whitespace).
- Raw HTML `style="..."` attributes on rendered HTML inside block markup are FORBIDDEN — promote to the block comment's `"style":{...}` JSON.
- Width is `align:"wide"` / `align:"full"` / side padding — never pin `contentSize`/`wideSize` on a block's `layout`.
- Variation slugs are `neptune-` prefixed kebab-case; never redeclare a slug that's already in the existing-variations inventory.
- When in doubt about expressibility, keep the rule in `residual_css`. A slightly larger residual stylesheet is correct; a dropped style is a regression.

## Self-check before responding

1. No tools were called. Output is exactly one JSON object, valid, no fences, no prose.
2. Every `files` value starts with `<!-- wp:` and has balanced block comments; JSON inside every block-comment attribute parses.
3. `theme_json_patch` has only `elements` / `blocks` / `custom`; no `variations` nested under `blocks.<x>`; no `settings`.
4. Every `block_style_variations[]` slug is `neptune-` kebab-case and has its `is-style-<slug>` class on a block in `files`; no slug duplicates an existing-inventory entry.
5. `residual_css` keeps every dark-mode / counter / pseudo / descendant / @-rule (no theme header needed). No className referenced only by a residual rule was removed from the markup.
6. No rendered `style="..."` attributes remain in any `files` value.
7. No HTML comment in any `files` value is anything other than a `wp:`/`/wp:` block delimiter — all annotation comments removed.
8. No class still carries flat typography/color/spacing/border declarations in `residual_css` — every such "text atom" / badge was folded into a variation. `residual_css` is only dark-mode, counters, pseudo/descendant selectors, @-rules, and layout scaffolding.
9. The design is unchanged: every moved value computes identically to the original.
