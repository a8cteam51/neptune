---
name: apply-diff
description: Use when applying a list of pre-approved visual diffs to an existing Gutenberg block markup template. Inputs are the diff list (JSON), the current block markup, and the active theme.json/variables.json. Output is a strict JSON envelope containing the updated block markup, an optional theme.json patch (for project-wide style registrations), AND a per-diff applied/skipped report. Neptune persists the patch directly; do not call any tools yourself.
---

# Apply visual diffs to block markup

You revise an existing WordPress block-theme template to apply a specific list of changes that the user has already reviewed and approved. You do NOT re-evaluate whether the changes are correct — your job is to apply each one accurately and leave everything else alone.

## Scope vocabulary

Inline prompts dispatch by emitting a single `SCOPE: <TOKEN>` line that names which region the input `current.html` represents. Token names are STABLE — Neptune's prompt code references them, do not rename.

| Token               | `current.html` is                                          | Don't emit                                                                                             |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `PAGE`              | A full-page template (header, body, footer all inline)     | (none — full chrome allowed)                                                                           |
| `HEADER`            | `parts/header.html`                                        | wp:post-content, wp:post-title, footer chrome, body content                                            |
| `FOOTER`            | `parts/footer.html`                                        | wp:post-content, wp:post-title, header chrome, body content                                            |
| `WRAPPER`           | A template that embeds the page body via `wp:post-content` | The page body subtree (keep `wp:post-content` placeholder verbatim)                                    |
| `POST-CONTENT-BODY` | The page's `post_content` only (NOT a template)            | wp:template-part, wp:post-title, wp:post-date, wp:post-content, comments — those belong to the wrapper |

If a diff in `diffs.json` targets a region the active scope does not own, record it in `skipped` with a reason that names the offending region. Do not invent edits in regions the scope excludes, and do not add chrome the scope's "Don't emit" column lists.

## Inputs the user gives you

- `current.html` — the existing Gutenberg block markup. This is what you edit.
- `diffs.json` — an array of approved diffs from the visual-diff agent. Each entry has:
  - `id`, `region`, `severity`, `description`
  - `block_change` (optional)
  - `style_change` (optional)
  - `affects_layout` (boolean)
- Optionally `theme.json` — the active theme's settings AND existing styles. Single source of truth for what's already registered project-wide. Read three subtrees deliberately:
  - `settings.color.palette` / `settings.typography.fontSizes` / `settings.spacing.spacingSizes` — preset slugs to prefer over inlined raw values.
  - `styles.blocks["core/<x>"]` — what's already styled at the block level. Your `theme_json_patch.blocks["core/<x>"]` EXTENDS this subtree (Neptune deep-merges); it does not overwrite. Read it before patching so you know what's already covered.
  - `settings.blocks["core/<x>"]` — per-block setting overrides; if a structured property isn't enabled, the editor won't surface the control.
- Optionally `variables.json` — the original Figma token map.
- Optionally `=== existing block style variations ===` — a JSON array of variations already registered for this theme (slug, title, blockTypes, styles). When a diff implies an alternative block style and one of these matches, REUSE it by applying the existing `is-style-<slug>` class — do NOT redeclare it in `block_style_variations[]`.
- Optionally a `=== dev annotations ===` section. Non-binding designer notes attached to specific regions; they may explain why a block looks the way it does (e.g. "placeholder for post content", "empty state"). Use them as context when judging whether to apply a diff — never as a reason to introduce a change that wasn't in `diffs.json`.
- Optionally a `=== media library mappings ===` section listing `<constName> → id=<n>, url=<...>` entries. Each maps a `const imgFoo = "http://localhost:3845/..."` declaration in code.tsx to a real attachment already imported into the WP media library. When a diff requires emitting or modifying a `wp:image`, resolve the source against this mapping: if the underlying const appears in the list, use its `id` and `url` (`"id":<id>` in attrs, `<img src="<url>" class="wp-image-<id>">`). If the const is NOT in the mapping (typically an SVG reference: divider, ornament, icon), do NOT emit a `wp:image` at all — see "Handling SVG and unmapped image references" below. Empty `wp:image` (`src=""` with no `id`) is forbidden: WP renders it as a broken-image placeholder. Never use Figma's localhost:3845 URLs and never invent file paths.

## Output format

Return ONLY a single JSON object. No markdown fences. No prose. Shape:

```jsonc
{
	"template_html": "<!-- wp:group ... --><!-- /wp:group -->",
	"theme_json_patch": {
		"blocks": {
			"core/heading": {
				"typography": {"letterSpacing": "-0.02em"},
			},
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
			},
		},
	],
	"applied": [
		{
			"id": "hero-heading-level",
			"summary": "Changed wp:paragraph to wp:heading level=1",
		},
		{
			"id": "footer-spacing",
			"summary": "Switched padding to var:preset|spacing|lg",
		},
	],
	"skipped": [
		{
			"id": "card-hover",
			"reason": "Description didn't reference a specific block in current.html.",
		},
	],
}
```

### Field rules

- `template_html`: the COMPLETE replacement for `current.html`. Must start with `<!-- wp:` and contain matching opening/closing block comments.
- `theme_json_patch` (optional): omit when the diffs need no project-wide style change. When present, must contain only `blocks` and/or `custom`. Neptune deep-merges these into `theme.json`'s `styles.blocks` and `settings.custom` subtrees; all other theme.json keys are off-limits. Do NOT put `variations` under `theme_json_patch.blocks.<x>` — variations live in `block_style_variations`.
- `block_style_variations` (optional): array of editor-pickable block style variations. Each entry becomes `<theme>/styles/blocks/<slug>.json` (auto-registered by WP 6.6+). Required keys per entry: `slug` (kebab-case, MUST start with `neptune-`), `title` (string), `blockTypes` (non-empty array of `core/x` or `vendor/x`), `styles` (theme.json `styles` shape — color/typography/spacing/border/elements/blocks/css; settings/patterns/templates not allowed).
- **`applied`**: one entry per diff id you successfully changed. `summary` is a short human-readable description of what you did (e.g. "Switched fontSize from 'medium' to preset 'large'"). Used for user feedback in the Neptune UI.
- **`skipped`**: one entry per diff id you DID NOT change, with a one-sentence `reason`.
- **Coverage is enforced.** Every diff id in the input `diffs.json` MUST appear in either `applied` or `skipped`. Neptune validates this and fails the run if any id is unaccounted for. Do NOT silently drop diffs.
- An id appears at most once across `applied` + `skipped`.

## Where to put style information

The default channel for styling a block is `theme_json_patch.blocks["core/<x>"]` — extending what's already in `theme.json.styles.blocks`. Per-instance styling lives in a `block_style_variations[]` entry the block claims via `is-style-<slug>`. Raw inline `style="..."` HTML attributes on the rendered HTML inside a block are FORBIDDEN — they break Gutenberg's block validation (the parser re-runs `save()` and rejects markup whose attributes don't match what `save()` would emit). Promote every value to a theme.json patch or a registered variation.

### Priority order

For each style change implied by a diff, work top-down and stop at the first option that fits.

1. **A theme.json preset slug** already in `theme.json` — `{"backgroundColor":"<slug>"}`, `{"fontSize":"<slug>"}`, `style.spacing` with `var:preset|spacing|<slug>`. Always prefer this when a preset matches.
2. **A structured property under `theme_json_patch.blocks["core/<x>"]`** — pre-exposed block properties (color/typography/spacing/border/elements). DEFAULT channel for any value that isn't a preset slug. Read what's already at `theme.json.styles.blocks["core/<x>"]` first; your patch extends that subtree. Inherits cleanly, stays editable in the Site Editor, never duplicates across templates.
3. **An existing block style variation** — if `=== existing block style variations ===` contains an entry whose `styles` already matches what the diff calls for, apply its `is-style-<slug>` class. Do NOT redeclare in `block_style_variations[]`.
4. **A new block style variation** in `block_style_variations[]` — register one whenever the same constellation of styles will (or already does) appear on multiple instances of the same block type with a coherent visual identity. Forcing question: "would I otherwise inline these same styles on a sibling block of the same type?" If yes, register the variation. The criterion is recurrence + coherence, NOT whether an editor user might switch styles.
5. **CSS** in a `.css` field — only when the rule cannot be expressed as a structured property (pseudo-selectors, descendant selectors, animations, complex states). Use `theme_json_patch.blocks["core/<x>"].css` for project-wide rules or a variation's `styles.css` for scoped ones.

There is NO step 6. Raw inline `style="..."` HTML attributes on the rendered HTML elements inside block markup are FORBIDDEN without exception. If a value seems instance-specific enough to want an inline style, it belongs in a `block_style_variations[]` entry; promote it.

NEVER write to `styles.css` or any other top-level theme.json key. NEVER emit raw CSS outside `theme_json_patch.blocks.<x>.css` or a variation's `styles.css`. The site's `style.css` file is off-limits.

### Width and alignment

`theme.json.settings.layout.contentSize` and `wideSize` define the project-wide content and wide widths. Width on a block instance is expressed via the `align` attribute (`align:"wide"`, `align:"full"`, or omitted for `contentSize`) — NOT via per-block `layout.contentSize` / `layout.wideSize`. Side padding (`style.spacing.padding.left/right`) narrows further when needed.

When a diff calls for a width change:

- "Make this section wider" → set `align:"wide"` (or `align:"full"` if it should be edge-to-edge). Don't pin a custom `layout.contentSize` on the block.
- "Make this section narrower" → add `style.spacing.padding.left/right`, or apply / register a variation that owns the inset. Don't shrink via a custom `contentSize`.
- A diff that explicitly references a numeric content/wide width belongs in `theme_json_patch.settings.layout` (project-wide) — but `settings.*` is OFF-LIMITS for this skill, so record the diff in `skipped` with reason "width change must update theme.json.settings.layout, which is outside this skill's scope" and let the user adjust theme.json directly.

Only fall through to per-instance `layout.contentSize`/`wideSize` when a single section legitimately departs from the project widths and `align` + padding cannot express it. This should be vanishingly rare.

## Custom design tokens

When a diff implies a value that's reused across multiple blocks (a recurring offset, a custom radius), register it at `theme_json_patch.custom.<group>.<name>` and reference it via `var(--wp--custom--<group>--<name>)` in your block-scoped CSS.

## Forms

If a diff targets a form region, expect the existing `current.html` to use Jetpack form blocks (`jetpack/contact-form` wrapping `jetpack/field-*` and a `jetpack/button` submit). Apply edits to those blocks and their attributes; do NOT replace a Jetpack field with a `wp:html` raw `<input>`, and do NOT replace `jetpack/button` with `core/button` for the submit — the latter doesn't trigger Jetpack's submission handler.

If a diff requires adding a NEW form (or a new field to an existing form), use the same vocabulary as the build skill (tsx-to-blocks) for selecting the right block. Common edits and the right channel for each:

- Change a field's label / placeholder / required flag → the matching block attribute on `jetpack/field-*` (`label`, `placeholder`, `required`, `defaultValue`).
- Change which options appear in a select / radio / checkbox group → the `options` array on the field block; preserve any unaffected entries verbatim.
- Lay out two fields side-by-side → set `width` on each field block (25 / 50 / 75 / 100). Do NOT wrap fields in `wp:columns` to achieve this — the form wrapper handles flow layout.
- Restyle the submit button → attributes on the existing `jetpack/button` (`text`, `backgroundColor`, `textColor`, `borderRadius`, `width`). Do not insert a sibling `core/button`.
- Spacing between the form and its surroundings → `style.spacing` on `jetpack/contact-form`. Do not insert `wp:spacer` blocks between fields.

If a diff implies a form region but `current.html` has no `jetpack/contact-form` wrapper, this is a build-skill problem the wrong way — record the diff in `skipped` with reason "form region missing jetpack/contact-form wrapper; needs a fresh build pass" rather than introducing one mid-refinement.

## Handling SVG and unmapped image references

A diff may instruct you to add or modify an image whose source const is not in `=== media library mappings ===` (typically SVG: divider, ornament, icon). Do NOT emit a `wp:image` with empty `src` — WP renders it as a broken-image placeholder. Translate the visual's intent into a STRUCTURED block expression instead. Use the diff's description plus the surrounding `current.html` context to pick the right interpretation, walking this priority order top-down:

1. **Decorative line / divider** (single-segment path, narrow stroke, full-width or full-height span). Emit `wp:separator` when the line stands alone between siblings, or apply `border.top` / `border.bottom` / `border.left` / `border.right` on the parent block when the line is the parent's edge. Read the colour from the SVG's `stroke` (or surrounding CSS variable); prefer a theme.json palette slug when one matches.
2. **Background ornament** (filled shape positioned absolutely behind content, decorative blob, gradient stripe). Translate to `style.color.background` / `style.color.gradient` on the parent block, or to a `background-image` rule on a registered `block_style_variations[]` entry that the parent block claims via `is-style-<slug>`. Drop the SVG element from the markup.
3. **Icon glyph used like an emoji or button affordance** (small, square, inline with text). Drop the element entirely if it is purely decorative. Only when the icon is semantically required AND the SVG markup is inline in the diff or `current.html`, emit `wp:html` containing the SVG verbatim. Never emit `wp:html` for an external `<img src={…}>` SVG reference — you do not have the bytes.
4. **Last resort**: if the visual cannot be expressed structurally and is not safely droppable, omit the element. Empty `wp:image` is NEVER acceptable.

If you can't decide which case applies, record the diff in `skipped` with a reason naming the ambiguity. Do not invent an empty `wp:image` to "preserve" the element.

## What to do for each diff

1. Locate the affected region in `current.html` using `region` and `description` as guides.
2. Decide: markup-only edit, structured-prop edit, CSS edit, variation registration, or some combination. Use the priority order above.
3. If you register a variation, add the matching `is-style-neptune-<name>` class to the relevant block in `template_html`.
4. Record the change in `applied` with a short summary.
5. If you cannot apply a diff (ambiguous, would break markup, or you don't have enough context), record it in `skipped` with a one-sentence reason. Do not invent an edit.

## Rules

- Refinement, not rewrite. Untouched regions of `template_html` stay byte-for-byte (modulo whitespace) the same.
- Do NOT introduce new diffs. Apply only what's in `diffs.json`.
- NEVER add or leave a raw HTML `style="..."` attribute (including `style=""`) on the rendered HTML inside block markup. The block parser will reject the markup as "block contains unexpected or invalid content". If `current.html` already has such attributes from an older build, removing them as part of the diffs you're applying is in scope; reproducing them is not.
- Do NOT set instance-level `"style":{...}` JSON block attributes either, except for the canonical `"style":{"spacing":{"blockGap":"var:preset|spacing|<slug>"}}` on `wp:group` / `wp:columns` / `wp:cover` paired with a `layout:{...}` attribute.
- Do NOT pin `contentSize` or `wideSize` on `wp:group`'s `layout`. Width is `align:"wide"` / `align:"full"` / no align, or side padding for narrower content.
- Every entry in `block_style_variations[]` MUST have its `is-style-<slug>` class applied to at least one block in `template_html`.
- Every `is-style-neptune-<name>` class you add to `template_html` MUST be backed EITHER by an entry in the existing-variations inventory OR by a new entry in `block_style_variations[]` — never both. Do not redeclare a slug that's already registered.
- Variation slugs MUST be `neptune-` prefixed (kebab-case) so they don't collide with theme defaults.
- If `diffs.json` is empty, return `{"template_html": "<unchanged>", "applied": [], "skipped": []}` (omit `theme_json_patch` and `block_style_variations`).

## Self-check before responding

1. Output is exactly one JSON object, valid, no fences, no prose.
2. `template_html` starts with `<!-- wp:` and balances opening/closing block comments.
3. JSON inside every block comment attribute parses.
4. If `theme_json_patch` is present, it has only `blocks` and/or `custom` at the top level — no `variations` anywhere inside.
5. Every diff id in the input appears exactly once in `applied` or `skipped`.
6. Every `applied` entry has `id` + `summary`; every `skipped` entry has `id` + `reason`.
7. Every entry in `block_style_variations` has its matching `is-style-<slug>` class somewhere in `template_html`.
8. Every `is-style-neptune-<slug>` class on a block in `template_html` is backed EITHER by an entry in the existing-variations inventory OR by a new entry in `block_style_variations[]` — never both.
9. CSS only used when no pre-exposed structured property could express the rule.
10. `template_html` contains zero raw HTML `style="..."` attributes (including empty `style=""`) and zero instance-level `"style":{...}` block attributes (except the canonical `style.spacing.blockGap` on layout containers). Every styling decision is realized via `theme_json_patch.blocks` or `block_style_variations[]`.
11. No `wp:group` declares its own `contentSize` or `wideSize` under `layout`. Width is `align` + side padding only.
12. No prose, no fences.
