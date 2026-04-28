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

The user invokes the entry-point skill (`check-environment`) explicitly. From there, each setup skill (`setup-project`, `dev-notes`, `map-design-templates`, `theme-json`) offers to chain to the next one **only if that next phase hasn't yet been recorded as completed in `neptune-config.json`**. Re-runs are idempotent: completed phases are not redone without explicit confirmation. The build/refine slash commands (steps 6+) are always run manually, one per invocation.

| Step | Invocation                                    | Purpose                                                          |
| ---- | ---                                           | ---                                                              |
| 1    | `check-environment` skill                     | Environment check.                                               |
| 2    | `setup-project` skill                         | Scaffold project + WordPress + theme clone.                      |
| 3    | `dev-notes` skill                             | Pull `💬 Dev Note` components from Figma into config.            |
| 4    | `map-design-templates` skill                  | Map Figma templates → WP files; scaffold empty files; capture Figma node IDs for each desktop/mobile layout and a preview `pageUrl` per entry. |
| 5    | `theme-json` skill                            | Generate `theme.json` from Figma styles and variables, and register template parts / custom templates from the mappings. |
| 6    | `/build-template <name>`                      | Populate one template/part wrapper with block markup, pulling the design from Figma. Run per unique `wordpressFile`. |
| 7    | `/build-content <name>`                       | Fill the body of one WP_Post / WP_Page from its Figma design. Run per `templateMappings` entry that shares a wrapper. |
| 8    | `/refine-template <name> <site-url>`          | Visual-diff a rendered template against Figma and refine the wrapper. |
| 9    | `/refine-content <name> <page-url>`           | Visual-diff a rendered page body against Figma and refine the post content. |
| —    | `/build-all-templates`, `/build-all-content`  | Batch wrappers around steps 6–7. Pause every 2 items for `/compact`. Build-only — never refine. |
| —    | `/refine-all-templates`, `/refine-all-content`| Batch wrappers around steps 8–9. Same pause cadence. |

## Project config file

All skills share state through `neptune-config.json` at the project root:

- `projectName`, `figmaFileId`, `repositoryUrl`, `themeSlug` — written by `init-project.sh` during `setup-project`.
- `setupProjectCompleted` (boolean) — set by `setup-project` once Studio site creation finishes.
- `devNotes` — the captured note objects, written by `dev-notes`.
- `devNotesCompleted` (boolean) — set by `dev-notes` once notes are written.
- `templateMappings` — per-Figma-template-card mapping object, written by `map-design-templates`. Keyed by Figma title-card name. Each entry has shape:
  ```json
  {
    "wordpressFile": "<path relative to the theme root>",
    "figmaNodes": {
      "desktop": "<figma-node-id>",
      "mobile":  "<figma-node-id>"
    },
    "pageUrl": "<full URL where this template renders>"
  }
  ```
  `figmaNodes` may include further breakpoint keys (e.g. `tablet`) when the design supplies them, and may omit `mobile` if the Figma title card has only one layout frame. `pageUrl` is consumed by `/build-content`, `/refine-*`, and header/footer nav wiring; entries that share a `wordpressFile` (e.g. multiple page designs all using `page.html`) all keep their own `figmaNodes` and `pageUrl`.
- `templateMappingsCompleted` (boolean) — set by `map-design-templates` once mappings are recorded and empty files scaffolded.
- `themeJsonCompleted` (boolean) — set by `theme-json` once `theme.json` is generated.

The `*Completed` booleans drive the conditional chain between setup skills (see Workflow). They do not gate the build/refine slash commands.

## Styling guardrails

When building templates:

- Prefer `theme.json` for anything the block APIs expose (colors, typography, spacing).
- Use block stylesheets in `assets/block-styles/src/*.scss` only for styling that `theme.json` cannot express. Name the file after the block it targets (e.g. `core-group.scss`).
- Never put custom CSS directly in `theme.json` or `style.css`.
- Use WordPress block markup only; never fall back to plain HTML inside templates.
