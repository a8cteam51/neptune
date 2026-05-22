---
name: theme-json
description: Use when building or generating a WordPress theme.json file from a flat JSON object of design tokens. Outputs a valid theme.json (block theme, schema version 3) mapping all tokens into the appropriate settings groups.
---

# Important Reading
- `https://schemas.wp.org/trunk/theme.json` for the official JSON schema.

# WordPress theme.json builder

Convert design tokens into a valid WordPress theme.json file for block themes (Full Site Editing).

## Operating mode

This skill is a single-shot prompt → JSON transform. Do NOT call any tools — no Agent / Task subagent dispatch, no Read / Write / Edit / Bash, no MCP. Neptune validates and persists the resulting theme.json itself. The only valid output is the raw JSON object described under "Output format".

## Default starter shape

```json
{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "settings": {
    "appearanceTools": true,
    "useRootPaddingAwareAlignments": true,
    "color": {
      "defaultDuotone": false,
      "defaultGradients": false,
      "defaultPalette": false,
      "palette": []
    },
    "typography": {
      "fontFamilies": [],
      "fontSizes": [],
      "fluid": true
    },
    "spacing": {
      "spacingSizes": [],
      "units": ["px", "rem", "em", "%", "vh", "vw"]
    },
    "layout": {
      "contentSize": "",
      "wideSize": ""
    }
  },
  "styles": {
    "elements": {}
  }
}
```

Always include `$schema` and `version: 3`.

## Mapping conventions

The input is a flat JSON object of design tokens, map them to the appropriate sections of `settings`. Some guardrails:

- Values who include `Font(` are part of typography settings. Extract `font-family` into `typography.fontFamilies` and `font-size` into `typography.fontSizes`. If the key includes an HTML element, e.g. `h1-font`, also capture that in `styles.elements` as a CSS selector (`h1`). `Normal` keys relate to body typography, `Heading` keys relate to heading typography.
- Values that look like colors (e.g. hex codes) go into `color.palette`.
- Values that look like spacing (e.g. `20px`, `1.5rem`) go into `spacing.spacingSizes`.

### Reserved Neptune keys (authoritative — do NOT skip or rename)

Two keys, when present, override every other layout heuristic. They carry values the user typed into Neptune's build-theme-json widths prompt and represent the canonical project widths:

- `__neptune__layout_content_size` → write its value verbatim into `settings.layout.contentSize`.
- `__neptune__layout_wide_size` → write its value verbatim into `settings.layout.wideSize`.

These keys override any Figma "Normal" / "Wide" tokens that might otherwise be inferred as layout widths. Treat the user's input as the source of truth for project widths; do not invent your own values, do not omit them, do not place them anywhere other than `settings.layout`. If a key's value is an empty string, write an empty string to the corresponding setting (the downstream build pipeline will surface that as an unset width). Do not emit either key as a token under `color`, `typography`, or `spacing` — they are not design tokens.

## Rules

- Slugs must be kebab-case, lowercase, alphanumeric + hyphens.
- Output JSON must be valid and parseable. No trailing commas. No comments.
- When using CSS variables generate by WordPress, include a single dash between letters and numbers, e.g. `var(--wp--preset--font-size--h-2)` not `var(--wp--preset--font-size--h2)`.
- Obvious Desktop and Mobile values should not be mapped separately, instead use CSS clamp() and set them both as the same value, e.g. `clamp(1.5rem, 2vw, 2rem)`. This is support by WordPress and allows for fluid typography and spacing.
- Try to keep slugs similar to the original token names for easier traceability, but convert to kebab-case and remove redundant words like "font" or "color" if possible. For example, `primary-color` can just be `primary`, and `h1-font-size` can just be `h-1`.
- Keep color slugs simple, e.g. `primary`, `secondary`, `background`, `foreground`, `contrast`. Don't include the color value in the slug, e.g. `primary-500` or `primary-blue` is not ideal. Multiples of the same slug should be differentiated with a number, e.g. `primary-1`, `primary-2` or `primary`, `primary-2`.

## Output format

Return ONLY the raw JSON for theme.json. Do not include markdown code fences. Do not include preamble, commentary, or explanation. Start with `{` and end with `}`.

## Self-check before responding

1. No tools were called. Output is exactly one JSON object, valid, no fences, no prose.
2. `$schema` is `https://schemas.wp.org/trunk/theme.json` and `version` is `3`.
3. Every slug is kebab-case lowercase alphanumeric + hyphens.
4. CSS variables of the form `var(--wp--preset--<group>--<slug>)` carry a single dash between letters and numbers (`--h-1`, never `--h1`).
5. Desktop / mobile pairs are collapsed into a single `clamp(min, fluid, max)` value where appropriate, not split into separate slugs.
6. No top-level keys other than `$schema`, `version`, `settings`, and `styles`.
7. If the input contained `__neptune__layout_content_size` or `__neptune__layout_wide_size`, their values are written verbatim into `settings.layout.contentSize` / `wideSize` and appear nowhere else in the output.
