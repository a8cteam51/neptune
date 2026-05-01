# theme.json contract

The subset of `theme.json` keys Neptune reads from and writes to, plus the merge rules and validation invariants. The `theme-json` skill writes this file from `figmaVariables` in `neptune-config.json`; the `theme-validator` subagent enforces the invariants below; build / refine commands resolve preset slugs against this contract.

`theme.json` requires WordPress 6.5+ for `appearanceTools`, `customTemplates`, `templateParts`, and `spacing.spacingSizes` as written here. Team51 sites all run a current WordPress, so target version `3` of the schema.

## Top-level shape

```json
{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "settings": { … },
  "styles": { … },
  "customTemplates": [ … ],
  "templateParts": [ … ]
}
```

The validator requires `version: 3` and a `$schema` pointing at `schemas.wp.org`. Anything else is an `ERROR`.

## settings

### `settings.appearanceTools`

```json
"appearanceTools": true
```

Enables the editor's appearance controls (border, color, dimensions, position, spacing, typography) in one switch instead of enumerating each `settings.color.background`, `settings.spacing.padding`, etc.

### `settings.layout`

```json
"layout": {
  "contentSize": "720px",
  "wideSize": "1200px"
}
```

`contentSize` caps the width of normal-aligned content inside `layout:constrained` groups. `wideSize` controls `align:wide`. Derive both from the Figma artboard's content frame width — if the design has an explicit container width variable in `figmaVariables`, prefer that.

### `settings.color.palette`

```json
"color": {
  "palette": [
    {"slug": "primary", "color": "#0066ff", "name": "Primary"},
    {"slug": "contrast", "color": "#111111", "name": "Contrast"},
    {"slug": "base", "color": "#ffffff", "name": "Base"},
    {"slug": "accent", "color": "#ff3366", "name": "Accent"}
  ]
}
```

Each slug becomes a CSS custom property `--wp--preset--color--<slug>` and is referenced by block attributes (`"textColor":"primary"`).

**Slug derivation from Figma variables.** Per `${CLAUDE_PLUGIN_ROOT}/references/dev-handoff-spec.md` §4.4, color variable paths use `<scope>/<name-or-step>` and Neptune writes them as `<scope>-<name-or-step>`. So `eureka/contrast-1` → palette slug `eureka-contrast-1`; `color/brand/primary` → `color-brand-primary` (or `brand-primary` if no other `primary` exists, by the figma-mapping conflict-resolution rule). Slugs MUST be unique across `color.palette`; the validator flags duplicates as an `ERROR`.

### `settings.color.gradients`

```json
"gradients": [
  {"slug": "warm", "name": "Warm", "gradient": "linear-gradient(135deg, #ff3366 0%, #ff9933 100%)"}
]
```

### `settings.typography.fontFamilies`

```json
"typography": {
  "fontFamilies": [
    {
      "slug": "sans",
      "name": "Sans",
      "fontFamily": "'Inter', system-ui, sans-serif",
      "fontFace": [
        {
          "fontFamily": "Inter",
          "fontStyle": "normal",
          "fontWeight": "400 700",
          "src": ["file:./assets/fonts/Inter-VariableFont.woff2"]
        }
      ]
    }
  ]
}
```

`fontFace` is optional but recommended for self-hosted fonts. `src` paths are relative to theme root using the `file:` protocol. **Never invent `fontFace` paths.** Only emit `fontFace` entries when the corresponding font file exists in `assets/fonts/`.

### `settings.typography.fontSizes`

```json
"fontSizes": [
  {"slug": "small", "size": "0.875rem", "name": "Small"},
  {"slug": "medium", "size": "1rem", "name": "Medium"},
  {"slug": "large", "size": "1.5rem", "name": "Large", "fluid": {"min": "1.25rem", "max": "1.5rem"}},
  {"slug": "x-large", "size": "2.5rem", "name": "Extra Large", "fluid": {"min": "2rem", "max": "2.5rem"}},
  {"slug": "xx-large", "size": "4rem", "name": "Display", "fluid": {"min": "3rem", "max": "4rem"}}
]
```

Add `fluid: { min, max }` for headings and display sizes (`large` and above). Slugs must be unique across `fontSizes`.

### `settings.typography.fluid`

```json
"fluid": true
```

Enables automatic fluid typography for any size with `fluid` set, plus opt-in for sizes without explicit fluid bounds.

### `settings.spacing.spacingSizes`

```json
"spacing": {
  "spacingSizes": [
    {"slug": "20", "size": "0.5rem", "name": "1"},
    {"slug": "30", "size": "1rem", "name": "2"},
    {"slug": "40", "size": "1.5rem", "name": "3"},
    {"slug": "50", "size": "2.5rem", "name": "4"},
    {"slug": "60", "size": "4rem", "name": "5"},
    {"slug": "70", "size": "6.5rem", "name": "6"},
    {"slug": "80", "size": "10rem", "name": "7"}
  ],
  "spacingScale": {"steps": 0}
}
```

Set `spacingScale.steps: 0` to disable WordPress's auto-generated scale and rely on the explicit sizes above.

**Slug convention.** Numeric slugs (`20`, `30`, …) by default. When the Figma file uses breakpoint-scoped spacing variables (`desktop/5`, `mobile/body-margin` per `${CLAUDE_PLUGIN_ROOT}/references/dev-handoff-spec.md` §4.5), keep the path-derived slug — `desktop/5` → `desktop-5`. Do not use semantic names (`small`, `large`) for spacing — they collide with font-size slugs in mental models even though they're a separate namespace.

## styles

`styles` defines the site-wide base values. Block-level overrides happen in block markup.

```json
"styles": {
  "color": {
    "background": "var(--wp--preset--color--base)",
    "text": "var(--wp--preset--color--contrast)"
  },
  "typography": {
    "fontFamily": "var(--wp--preset--font-family--sans)",
    "fontSize": "var(--wp--preset--font-size--medium)",
    "lineHeight": "1.6"
  },
  "elements": {
    "h1": {
      "typography": {
        "fontSize": "var(--wp--preset--font-size--xx-large)",
        "lineHeight": "1.1",
        "fontWeight": "700"
      }
    },
    "h2": { … },
    "h3": { … },
    "link": {
      "color": {"text": "var(--wp--preset--color--primary)"},
      ":hover": {"color": {"text": "var(--wp--preset--color--accent)"}}
    },
    "button": {
      "color": {
        "background": "var(--wp--preset--color--primary)",
        "text": "var(--wp--preset--color--base)"
      },
      "border": {"radius": "4px"},
      "spacing": {"padding": {"top": "0.75rem", "right": "1.5rem", "bottom": "0.75rem", "left": "1.5rem"}},
      ":hover": {"color": {"background": "var(--wp--preset--color--accent)"}}
    }
  }
}
```

Every `var(--wp--preset--<category>--<slug>)` reference in `styles` MUST resolve to a real slug in the corresponding preset array. The validator flags unresolved references as an `ERROR`.

## customTemplates

```json
"customTemplates": [
  {"name": "page-wide", "title": "Wide page", "postTypes": ["page"]},
  {"name": "page-no-title", "title": "Page without title", "postTypes": ["page"]}
]
```

Each entry corresponds to a `templates/<name>.html` file that's NOT one of the WP-recognized hierarchy templates (`index`, `home`, `front-page`, `single`, `singular`, `page`, `archive`, `category`, `tag`, `author`, `date`, `taxonomy`, `search`, `404`, `attachment`).

**Generated by `theme-json` from `templateMappings`.** Every entry whose `wordpressFile` lives under `templates/` and is not in the WP-recognized list becomes a `customTemplates` row. `name` derives from the filename without extension; `title` is human-readable from the Figma title-card name; `postTypes` defaults to `["page"]` (ask the user when ambiguous).

After registering a custom template, the user must select it in **Page Attributes → Template** on the relevant WP_Post / WP_Page or it will continue rendering with `page.html`.

## templateParts

```json
"templateParts": [
  {"name": "header", "title": "Header", "area": "header"},
  {"name": "footer", "title": "Footer", "area": "footer"}
]
```

Each entry corresponds to a `parts/<name>.html` file. `area` is `header`, `footer`, or `uncategorized`.

**Generated by `theme-json` from `templateMappings`.** Every entry whose `wordpressFile` lives under `parts/` becomes a `templateParts` row. `area` is inferred from the filename (`header.*` → `header`, `footer.*` → `footer`, otherwise `uncategorized`). `theme-json` always ensures `parts/header.html` and `parts/footer.html` are registered, even if `pull-figma` didn't capture dedicated title cards for them.

## Merge semantics

When `theme-json` re-runs (designer changes upstream variables), it MERGES into existing `theme.json`, not replaces:

- `settings.color.palette`: union by `slug`. Existing slugs keep their value unless the user explicitly approves overwriting.
- `settings.typography.fontSizes`: union by `slug`.
- `settings.typography.fontFamilies`: union by `slug`.
- `settings.spacing.spacingSizes`: union by `slug`.
- `styles.*`: never overwrite without explicit user confirmation. These are user-edited.
- `templateParts` / `customTemplates`: append entries that don't already exist; preserve existing entries.

Read the file, parse JSON, mutate in memory, write back with stable key ordering and 2-space indent.

## Validation invariants (enforced by `theme-validator`)

The subagent at `${CLAUDE_PLUGIN_ROOT}/agents/theme-validator.md` runs after any step that writes `theme.json` or theme files. It treats each of the following as an `ERROR`:

- File doesn't parse as JSON.
- `version` is not `3`.
- `$schema` is missing or not pointing at `schemas.wp.org`.
- A duplicate slug exists within any single preset array.
- A `templateParts` entry has no matching file at `parts/<name>.html`.
- A `customTemplates` entry has no matching file at `templates/<name>.html`.
- A preset reference in `styles.*`, in any template/part HTML, or in any block-style SCSS resolves to a slug not in `theme.json`.
- A `parts/*.html` file has no entry in `templateParts`.
- A `templates/*.html` file is neither in the WP-recognized list nor in `customTemplates`.

The validator additionally emits `WARNING` for: missing `appearanceTools`, missing `layout.contentSize` / `wideSize`, an empty palette, an empty `fontSizes`, an empty `spacingSizes`. These are recoverable but signal an incomplete `theme-json` run.
