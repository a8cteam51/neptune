---
name: refine-blocks
description: Use when refining an existing Gutenberg block markup template to better match a Figma design. Inputs include the current template, the design screenshot, the rendered screenshot of the live page, and a pixel-diff highlight. Outputs revised raw block markup ready to overwrite the template file.
---

# Refine block markup against a design screenshot

You revise an existing WordPress block-theme template so its rendered output matches a target design more closely. The target is a Figma screenshot; the current state is a screenshot of the live WordPress site rendering that template.

## Inputs the user will give you

- `current.html` — the existing Gutenberg block markup that produced the current render. This is what you edit.
- `design.png` — the design screenshot (from Figma). This is the target.
- `rendered.png` — the screenshot of the live WordPress page rendering `current.html`.
- `diff.png` — a pixel-difference highlight between `design.png` and `rendered.png`. Areas of disagreement are colored; matching pixels are faded. Use this to focus your attention.
- Optionally `theme.json` — the theme's preset palette / typography / spacing slugs. Use these in attributes when they match.
- Optionally `variables.json` — the original Figma token map.

If the design and rendered screenshots differ in resolution, the diff will be omitted; rely on the two source screenshots directly.

## What to change

Refine the existing block markup to close visible gaps with the design. Typical fixes:

- Wrong block type (e.g. a `wp:paragraph` where the design expects a `wp:heading`).
- Missing or extra blocks (e.g. a sub-headline, an icon row, a button group).
- Wrong colour, font size, or spacing slug — switch to one that maps to the design via `theme.json`.
- Wrong alignment / layout (e.g. constrained vs flex; column count).
- Missing or duplicated images.

Do NOT introduce churn that the diff doesn't justify: leave correctly-rendered blocks alone. Refinement, not rewrite.

## Output format

Return ONLY raw Gutenberg block markup. No markdown fences. No preamble. No commentary. The output replaces `current.html` verbatim, so:

- First non-whitespace characters: `<!-- wp:`.
- Every `<!-- wp:foo` has a matching `<!-- /wp:foo -->`.
- JSON inside block comment attributes parses (no trailing commas, double-quoted keys).
- No `<html>`, `<head>`, `<body>`. No React / TS / `import` / `function` / `const imgFoo` lines.
- Slugs are kebab-case, lowercase, alphanumeric + hyphens.
- Where a Tailwind-derived value matches a `theme.json` preset slug, prefer the named attribute (`backgroundColor`, `textColor`, `fontSize`, `style.spacing` with `var:preset|spacing|<slug>`) over a raw `style`.

## Self-check before responding

1. Output starts with `<!-- wp:` and ends with the matching closing comment.
2. JSON in every block comment attribute parses.
3. Every change traces back to something visible in the design vs rendered comparison.
4. No prose, no fences.
