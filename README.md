# neptune

A Claude Code plugin for building and maintaining WordPress block themes for Team 51 projects, driven by a linked Figma file as the design source of truth.

## What it does

Provides a step-by-step workflow (one skill or slash command per phase) that:

1. Verifies your local environment (WordPress Studio, Figma MCP, GitHub CLI, Team51 CLI, jq).
2. Scaffolds a project directory, clones your theme repo into `wp-content`, and stands up a Studio WordPress site.
3. Pulls dev notes and style variables from Figma into a per-project config file.
4. Maps Figma templates to WordPress block-theme files and scaffolds them empty.
5. Builds and refines each template using validated block markup, `theme.json`, and optional block stylesheets.

Block markup is validated against a real WordPress site through `mcp__wordpress-studio__validate_blocks` before being written to disk; performance and on-page-SEO sanity checks use the same MCP's `need_for_speed` and `rank_me_up` tools.

## Prerequisites

- macOS.
- [WordPress Studio](https://developer.wordpress.com/studio/) with the Block Themes agent skill installed.
- [Figma MCP](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#claude-code) enabled in Claude Code.
- [GitHub CLI (`gh`)](https://cli.github.com/), authenticated (`gh auth login`).
- Team51 CLI, configured.
- [`jq`](https://jqlang.org/) on `PATH` — used by the state-gate script.

Before running `setup-project`, you must also have run `team51 pressable:create-site` and created a GitHub repo from the no-code project template (leave the theme name empty).

## Workflow

The user invokes every skill explicitly. Each skill ends by **offering** the next step but never auto-invokes it — re-runs are idempotent only because the user gates them. Slash commands (steps 7+) are always run manually.

| Step | Invocation                                    | Purpose                                                                                                                                       |
| ---- | ---                                           | ---                                                                                                                                           |
| 1    | `check-environment` skill                     | Environment check.                                                                                                                            |
| 2    | `setup-project` skill                         | Scaffold project + WordPress + theme clone.                                                                                                   |
| 3    | `dev-notes` skill                             | Pull `💬 Dev Note` components from Figma into config.                                                                                         |
| 4    | `map-design-templates` skill                  | Map Figma templates → WP files; scaffold empty files; capture Figma node IDs for each desktop/mobile layout and a preview `pageUrl` per entry. |
| 5    | `theme-json` skill                            | Generate `theme.json` from Figma styles and variables, and register template parts / custom templates from the mappings.                       |
| 6    | `extract-patterns` skill                      | Lift reusable Figma components into WP block patterns under `patterns/` so subsequent build runs reference them by slug instead of re-emitting markup. Optional but recommended. |
| 7    | `/build-template <name>`                      | Populate one template/part wrapper with validated block markup, pulling the design from Figma. Run per unique `wordpressFile`.                 |
| 8    | `/build-content <name>`                       | Fill the body of one WP_Post / WP_Page from its Figma design. Run per `templateMappings` entry that shares a wrapper.                          |
| 9    | `/refine-template <name> <site-url>`          | Visual-diff a rendered template against Figma and refine the wrapper. Uses a measure-first / vision-fallback diff strategy.                    |
| 10   | `/refine-content <name> <page-url>`           | Visual-diff a rendered page body against Figma and refine the post content. Same diff strategy.                                                |
| —    | `/build-all-templates`, `/build-all-content`  | Batch wrappers around steps 7–8. **Spawn one subagent per item** (see "Batch execution" below). Build-only — never refine.                     |
| —    | `/refine-all-templates`, `/refine-all-content`| Batch wrappers around steps 9–10. Same subagent model.                                                                                         |

### Why explicit invocation?

Auto-chaining is opt-in to keep the user in control of when expensive Figma + Studio work runs and when checkpoints get recorded. Every skill ends with a one-line offer of the next step (and a note if that next step has already completed) but never invokes it for you.

## Batch execution

The four `*-all-*` commands act as **orchestrators**. They never execute the per-item procedure inline. Instead, for each item in their planned set, they spawn a subagent via the `Agent` tool that follows the matching per-item command's procedure (`build-template.md`, `build-content.md`, `refine-template.md`, `refine-content.md`) end-to-end.

Why subagents instead of inline-with-`/compact`-pauses:

- **Context isolation.** A 10-template build dragging every previous template's block markup, screenshots, and Figma payloads through the same window degrades quality on later items. Each subagent gets a fresh ~200k-token window with only the artifacts it needs.
- **No `/compact` dance.** The orchestrator's window stays small because each item's working state lives in the subagent. The user does not have to stop every two items to compact.
- **Predictable costs.** Every per-item subagent runs on Sonnet (`model: sonnet`). The orchestrator commands and the per-item slash commands also default to Sonnet. The one exception is `extract-patterns`, which stays on Opus — pattern extraction is the most consequential generative task in the pipeline because every subsequent build inherits its output, so the stronger model pays off many times over.

Subagents run **sequentially**, not in parallel. They share theme files, `theme.json`, `register_block_style` registrations, and the WP database — parallelism would race on every one of those. Sequential subagents that write to disk between items see each other's outputs cleanly.

The full execution model (orchestrator/subagent contract, return shape, `--skip` parsing) lives in `references/batch-policy.md`.

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
  `figmaNodes` may include further breakpoint keys (e.g. `tablet`) when the design supplies them, and may omit `mobile` if the Figma title card has only one layout frame. `pageUrl` is consumed by `/build-content`, `/refine-*`, and header/footer nav wiring; entries that share a `wordpressFile` (e.g. multiple page designs all using `page.html`) all keep their own `figmaNodes` and `pageUrl`. Stored URLs are validated with a `curl` HEAD before they're trusted; on a 4xx/5xx the command re-resolves via WP CLI rather than relying on stale state.
- `templateMappingsCompleted` (boolean) — set by `map-design-templates` once mappings are recorded and empty files scaffolded.
- `themeJsonCompleted` (boolean) — set by `theme-json` once `theme.json` is generated.
- `patterns` — registered block-pattern objects, written by `extract-patterns`. Keyed by pattern slug. Each entry carries `title`, `fullSlug` (`<themeSlug>/<pattern-slug>`), `figmaComponentId`, `figmaComponentKey`, and `file` (`patterns/<pattern-slug>.html`). Build commands consult this registry and emit `<!-- wp:pattern {"slug":"<fullSlug>"} /-->` instead of re-emitting the component's markup.
- `patternsCompleted` (boolean) — set by `extract-patterns` once the pattern lift has run (or when the user opts to skip the phase).

The `*Completed` booleans are inputs to `scripts/check-state.sh`, which every skill and command runs as its preflight step. They do not auto-chain — they only tell each skill/command whether the inputs it needs exist yet.

## Styling guardrails

When building templates:

- Prefer `theme.json` for anything the block APIs expose (colors, typography, spacing).
- Use block stylesheets in `assets/block-styles/src/*.scss` only for styling that `theme.json` cannot express. Name the file after the block it targets (e.g. `core-group.scss`).
- Never put custom CSS directly in `theme.json` or `style.css`.
- Use WordPress block markup only; never fall back to plain HTML inside templates.
- Validate every chunk of block markup via `mcp__wordpress-studio__validate_blocks` before writing it to disk or to a post.

## Accessibility, performance, and SEO guardrails

The build commands enforce production-grade defaults during the initial template/body fill: a single `<h1>` per page, no skipped heading levels, semantic landmarks (`<header>`, `<main>`, `<footer>`, `<nav>`, `<aside>`), `alt` text on `core/image` blocks (or an explicit GitHub follow-up if alt is unknown), `loading="lazy"` for below-the-fold images, `loading="eager"`/`fetchpriority="high"` for hero imagery, visible `:focus-visible` styles in any registered block style, and a skip link in any header part. After build, the commands optionally run `mcp__wordpress-studio__rank_me_up` and `mcp__wordpress-studio__need_for_speed` against the resolved URL and surface failures as GitHub issues.

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
