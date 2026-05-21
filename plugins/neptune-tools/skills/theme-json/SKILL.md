---
name: theme-json
description: Use when building or generating a WordPress theme.json file from a flat JSON object of design tokens. Maps the tokens into a valid theme.json (block theme, schema version 3), writes the file to the active theme directory, and flushes WP's resolved-theme.json cache.
---

# Important Reading
- `https://schemas.wp.org/trunk/theme.json` for the official JSON schema.

# WordPress theme.json builder

Convert design tokens into a valid WordPress theme.json file for block themes (Full Site Editing).

## Operating mode

You compute the theme.json content from the supplied design tokens AND persist it yourself. The host loads the **pull-writer** skill alongside this one; pull-writer's Recipe 5 is the cache flush you call at the end.

Available tools:

- `Write` — for writing the theme.json to disk at the path the host names in the task brief.
- `mcp__haydi__haydi_run_php` — for the cache flush (Recipe 5).
- NO `Task`, NO `Bash`, NO `Edit` (theme.json is created/overwritten in one shot — Edit's string-replacement semantics don't apply here).

Final response: a terse plaintext summary, one line per artifact written. NO JSON, NO markdown fences, NO narration.

If the host's task brief says Haydi is not configured for this run, skip the cache flush — write the file and emit only the "wrote ..." summary line.

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
- `Normal` and `Wide` values go into `layout.contentSize` and `layout.wideSize` respectively.

## Rules

- Slugs must be kebab-case, lowercase, alphanumeric + hyphens.
- Output JSON must be valid and parseable. No trailing commas. No comments.
- When using CSS variables generate by WordPress, include a single dash between letters and numbers, e.g. `var(--wp--preset--font-size--h-2)` not `var(--wp--preset--font-size--h2)`.
- Obvious Desktop and Mobile values should not be mapped separately, instead use CSS clamp() and set them both as the same value, e.g. `clamp(1.5rem, 2vw, 2rem)`. This is support by WordPress and allows for fluid typography and spacing.
- Try to keep slugs similar to the original token names for easier traceability, but convert to kebab-case and remove redundant words like "font" or "color" if possible. For example, `primary-color` can just be `primary`, and `h1-font-size` can just be `h-1`.
- Keep color slugs simple, e.g. `primary`, `secondary`, `background`, `foreground`, `contrast`. Don't include the color value in the slug, e.g. `primary-500` or `primary-blue` is not ideal. Multiples of the same slug should be differentiated with a number, e.g. `primary-1`, `primary-2` or `primary`, `primary-2`.

## Output format

1. Compute the full theme.json content from the supplied design tokens, using the starter shape above as a foundation.
2. Write the file with the `Write` tool to the absolute path the host names in the task brief. Indent with two spaces, end with a single trailing newline. The full content goes in one Write call — do not split.
3. If the host's brief indicates Haydi is configured, run pull-writer Recipe 5 (`wp_cache_flush();`) via `mcp__haydi__haydi_run_php`. One flush, after the write.
4. Emit a terse plaintext summary, e.g.:

```
wrote /Users/.../wp-content/themes/<themeSlug>/theme.json (12834 bytes)
flushed theme.json cache
```

NO JSON in your final response. NO markdown fences. NO commentary.

## Self-check before responding

1. theme.json was Written via the Write tool at the brief's path (not echoed in the response).
2. `$schema` is `https://schemas.wp.org/trunk/theme.json` and `version` is `3`.
3. Every slug is kebab-case lowercase alphanumeric + hyphens.
4. CSS variables of the form `var(--wp--preset--<group>--<slug>)` carry a single dash between letters and numbers (`--h-1`, never `--h1`).
5. Desktop / mobile pairs are collapsed into a single `clamp(min, fluid, max)` value where appropriate, not split into separate slugs.
6. No top-level keys other than `$schema`, `version`, `settings`, and `styles`.
7. Cache flush ran ONCE iff Haydi was configured for this run.
