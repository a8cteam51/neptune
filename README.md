# neptune

A Claude Code plugin for building and maintaining WordPress block themes for Team 51 projects, driven by a linked Figma file as the design source of truth.

## What it does

Provides a step-by-step workflow (one skill or slash command per phase) that:

1. Verifies your local environment (WordPress Studio, Figma MCP, GitHub CLI, Team51 CLI).
2. Scaffolds a project directory, clones your theme repo into `wp-content`, and stands up a Studio WordPress site.
3. Pulls dev notes and style variables from Figma into a per-project config file.
4. Maps Figma templates to WordPress block-theme files and scaffolds them empty.
5. Builds and refines each template using block markup, `theme.json`, and optional block stylesheets.

## Prerequisites

- macOS.
- [WordPress Studio](https://developer.wordpress.com/studio/) with the Block Themes agent skill installed.
- [Figma MCP](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#claude-code) enabled in Claude Code.
- [GitHub CLI (`gh`)](https://cli.github.com/), authenticated (`gh auth login`).
- Team51 CLI, configured.

Before running `setup-project`, you must also have run `team51 pressable:create-site` and created a GitHub repo from the no-code project template (leave the theme name empty).

## Workflow

Each step below is invoked manually — the plugin never auto-chains.

| Step | Invocation                             | Purpose                                                          |
| ---- | ---                                    | ---                                                              |
| 1    | `neptune` skill                        | Environment check.                                               |
| 2    | `setup-project` skill                  | Scaffold project + WordPress + theme clone.                      |
| 3    | `dev-notes` skill                      | Pull `💬 Dev Note` components from Figma into config.            |
| 4    | `map-design-templates` skill           | Map Figma templates → WP files; scaffold empty files; capture Figma node IDs for each desktop/mobile layout. |
| 5    | `download-assets` skill                | Export every image from the desktop Figma layouts to `/assets/`, import into WP media library, and record the Figma-image-to-WP-attachment map in `neptune-config.json`. |
| 6    | `theme-json` skill                     | Generate `theme.json` from Figma styles and variables, and register template parts / custom templates from the mappings. |
| 7    | `/build-template <name>`               | Populate one template/part with block markup, pulling the design directly from Figma via the Figma MCP. Run per template. |
| 8    | `/refine-template <name> <site-url>`   | Visual-diff rendered output against the live Figma design and refine. |

## Project config file

All skills share state through `neptune-config.json` at the project root:

- `projectName`, `figmaFileId`, `repositoryUrl`, `themeSlug` — written by `init-project.sh` during `setup-project`.
- `devNotes` — written by `dev-notes`.
- `templateMappings` — written by `map-design-templates`.
- `figmaAssets` — written by `download-assets`. Map keyed by Figma image hash; each value carries the local path under `/assets/`, the WP attachment ID and URL, and the list of Figma node IDs that share the image. `/build-template`, `/build-content`, `/refine-template`, and `/refine-content` look images up here when generating or correcting `<!-- wp:image -->` markup.

## Styling guardrails

When building templates:

- Prefer `theme.json` for anything the block APIs expose (colors, typography, spacing).
- Use block stylesheets in `assets/block-styles/src/*.scss` only for styling that `theme.json` cannot express. Name the file after the block it targets (e.g. `core-group.scss`).
- Never put custom CSS directly in `theme.json` or `style.css`.
- Use WordPress block markup only; never fall back to plain HTML inside templates.
