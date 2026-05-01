# neptune

A Claude Code plugin for building and maintaining WordPress block themes for Team 51 projects, driven by a linked Figma file as the design source of truth.

## What it does

Provides a step-by-step workflow (one skill or slash command per phase) that:

1. Verifies your local environment (WordPress Studio, Figma MCP, GitHub CLI, Team51 CLI, jq).
2. Scaffolds a project directory, clones your theme repo into `wp-content`, and stands up a Studio WordPress site.
3. Pulls dev notes and style variables from Figma into a per-project config file.
4. Maps Figma templates to WordPress block-theme files and scaffolds them empty.
5. Builds and refines each template using validated block markup, `theme.json`, and optional block stylesheets.

Block markup is validated against a real WordPress site through `mcp__wordpress-studio__validate_blocks` before being written to disk. Cross-file invariants (theme.json schema, slug uniqueness, `templateParts`/`customTemplates` ↔ files on disk, preset reference resolution, required blocks per template slug) are enforced by a `theme-validator` subagent that runs after `theme-json`, after every `/build-template`, and after refinements that touch theme files.

## Prerequisites

- macOS.
- [WordPress Studio](https://developer.wordpress.com/studio/) with the Block Themes agent skill installed.
- [Figma MCP](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#claude-code) enabled in Claude Code.
- [GitHub CLI (`gh`)](https://cli.github.com/), authenticated (`gh auth login`).
- Team51 CLI, configured.
- [`jq`](https://jqlang.org/) on `PATH` — used by the state-gate script.

Before running `setup-project`, you must also have run `team51 pressable:create-site` and created a GitHub repo from the no-code project template (leave the theme name empty).

## Workflow

Skills 1–5 auto-chain: each skill loads and follows the next one automatically when it completes. Slash commands (steps 6+) are always run manually per template or page.

| Step | Invocation                           | Purpose                                                                                                                                        |
| ---- | ---                                  | ---                                                                                                                                            |
| 1    | `check-environment` skill            | Environment check. Auto-chains into `setup-project`.                                                                                          |
| 2    | `setup-project` skill                | Scaffold project + WordPress + theme clone. Capture the Figma dev-handoff page URL. Auto-chains into `pull-figma`.                            |
| 3    | `pull-figma` skill                   | Walk the Figma dev-handoff page **once** and write every structural slice (template candidates, style-guide pointer, theme assets, dev notes, variable defs) into `neptune-config.json`. Auto-chains into `map-design-templates`. |
| 4    | `map-design-templates` skill         | Confirm each candidate's WP file + page URL with the user; scaffold empty theme files. No Figma walking — pure config consumer. Auto-chains into `theme-json`. |
| 5    | `theme-json` skill                   | Generate `theme.json` from `figmaVariables` in config plus a targeted `get_design_context` on the style-guide node. Register template parts / custom templates. |
| 6    | `/build-template <name>`             | Populate one template/part wrapper with validated block markup, pulling the design from Figma. Run per unique `wordpressFile`.                  |
| 7    | `/build-content <name>`              | Fill the body of one WP_Post / WP_Page from its Figma design. Run per `templateMappings` entry that shares a wrapper.                          |
| 8    | `/refine-template <name> <site-url>` | Visual-diff a rendered template against Figma and refine the wrapper. Uses a measure-first / vision-fallback diff strategy.                     |
| 9    | `/refine-content <name> <page-url>`  | Visual-diff a rendered page body against Figma and refine the post content. Same diff strategy.                                                 |

The user provides the Figma dev-handoff page URL **once** during `setup-project`. From that one URL, `pull-figma` extracts everything Neptune needs into `neptune-config.json`. Every downstream skill and slash command reads from `neptune-config.json` rather than walking Figma to discover structural information.

## Project config file

All skills share state through `neptune-config.json` at the project root:

- `projectName`, `figmaFileId`, `figmaDevHandoffNodeId`, `repositoryUrl`, `themeSlug` — written by `init-project.sh` during `setup-project`. `figmaDevHandoffNodeId` is the `X:Y` id of the dev-handoff page, extracted from the URL the user pastes during setup.
- `setupProjectCompleted` (boolean) — set by `setup-project` once Studio site creation finishes.
- `figmaVariables` — raw output of `mcp__figma__get_variable_defs` for the dev-handoff page, captured by `pull-figma`. Drives `theme-json`'s palette / typography / spacing emission.
- `figmaStyleGuideNodeId` — id of the `🎨 Style Guide` section, captured by `pull-figma`. `theme-json` calls `get_design_context` on it to cross-reference variables against rendered styles.
- `devNotes` — every `💬 Dev Note` instance on the dev-handoff page, captured by `pull-figma`. Each entry: `{id, text, context, x, y}`.
- `figmaPullCompleted` (boolean) — set by `pull-figma` once the walk has populated all of the above.
- `templateMappings` — per-Figma-title-card mapping object. Initial candidates (with `figmaTitleCardId`, `figmaTitleTextId`, `figmaNodes.{desktop, mobile?}`, `proposedWordpressFile`) are written by `pull-figma`. `map-design-templates` then confirms each entry and adds `wordpressFile` and `pageUrl`. Final shape:
  ```json
  {
    "<title>": {
      "wordpressFile": "<path relative to the theme root>",
      "figmaTitleCardId": "<figma-node-id>",
      "figmaTitleTextId": "<figma-node-id>",
      "figmaNodes": {
        "desktop": "<figma-node-id>",
        "mobile":  "<figma-node-id>"
      },
      "pageUrl": "<full URL where this template renders>",
      "proposedWordpressFile": "<unchanged hint from pull-figma>"
    }
  }
  ```
  `figmaNodes` may include further breakpoint keys (e.g. `tablet`) when the design supplies them, and may omit `mobile` if the Figma title card has only one layout frame. `pageUrl` is consumed by `/build-content`, `/refine-*`, and header/footer nav wiring; entries that share a `wordpressFile` all keep their own `figmaNodes` and `pageUrl`. Stored URLs are validated with a `curl` HEAD before they're trusted; on a 4xx/5xx the command re-resolves via WP CLI rather than relying on stale state.
- `templateMappingsCompleted` (boolean) — set by `map-design-templates` once each entry is confirmed and the empty theme files are scaffolded.
- `themeJsonCompleted` (boolean) — set by `theme-json` once `theme.json` is generated.

The `*Completed` booleans are inputs to `scripts/check-state.sh`, which every skill and command runs as its preflight step. They signal to each skill/command whether the inputs it needs exist yet.

`pull-figma` is **safe to re-run**. When the Figma file changes (designer adds a template, updates the style guide), invoking `pull-figma` again refreshes the figma-derived slices of `neptune-config.json` while preserving user-confirmed fields like `wordpressFile` and `pageUrl` on existing `templateMappings` entries.

## Styling guardrails

When building templates:

- Prefer `theme.json` for anything the block APIs expose (colors, typography, spacing).
- Use block stylesheets in `assets/block-styles/src/*.scss` only for styling that `theme.json` cannot express. Name the file after the block it targets (e.g. `core-group.scss`).
- Never put custom CSS directly in `theme.json` or `style.css`.
- Use WordPress block markup only; never fall back to plain HTML inside templates.
- Validate every chunk of block markup via `mcp__wordpress-studio__validate_blocks` before writing it to disk or to a post.

## Accessibility, performance, and SEO guardrails

The build commands enforce production-grade defaults during the initial template/body fill: a single `<h1>` per page, no skipped heading levels, semantic landmarks (`<header>`, `<main>`, `<footer>`, `<nav>`, `<aside>`), `alt` text on `core/image` blocks (or an explicit GitHub follow-up if alt is unknown), `loading="lazy"` for below-the-fold images, `loading="eager"`/`fetchpriority="high"` for hero imagery, visible `:focus-visible` styles in any registered block style, and a skip link in any header part.

## Visual-diff strategy

`/refine-template` and `/refine-content` use a **measure-first / vision-fallback** diff:

- **Stage A (numeric).** Pull the Figma node's measured properties via `mcp__figma__get_design_context` and `mcp__figma__get_variable_defs`. Compare against the rendered DOM's computed styles (via `theme.json` declarations, block stylesheets, and serialised block `style=` attributes; via `studio wp_cli` introspection where browser-side measurement isn't reliably available). Anything outside ±1px on layout, ±2% perceptual on color, or any difference in `font-weight` / `font-family` / token name is a discrepancy.
- **Stage B (visual).** Take matching-breakpoint screenshots (Studio's `take_screenshot`) and visually compare for things numbers don't catch: alignment, z-order, missing/extra elements, overflow, broken responsive behaviour.

When a vision impression contradicts a numeric measurement, the numeric measurement wins. The discrepancy table the user sees lists rows from both stages with a `source` column (`measured` / `visual`).

## State-gate script

Skills and commands no longer re-implement the same "read config / nag user / fall through" prologue. Every skill and command's first step is `scripts/check-state.sh <key1> [key2 ...]`, which fails fast with a one-line message naming the skill the user should run first if any required key is missing. Each `*Completed` boolean and each data key (`templateMappings`, `devNotes`, etc.) maps to a single hint string, kept aligned with the workflow table above.

## Notes

- `wp-blockmarkup` MCP is no longer used. Block-markup validation goes through `mcp__wordpress-studio__validate_blocks` against a running Studio site, so the validation context matches the site the markup will actually render in.
- If Studio MCP isn't loading, run `studio mcp` directly on the command line; it should describe how to register the server with Claude Code.
