---
description: Build a single template or template part in the WordPress theme from its mapped Figma design using block markup.
argument-hint: [template-or-part-name]
---

Build the template or template part named in `$ARGUMENTS` for the current Team 51 project. If `$ARGUMENTS` is empty, ask the user which template or part to build from the `templateMappings` in `neptune-config.json`. This command is invoked once per template or part.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`.
- The `wp-blockmarkup` MCP — use it to generate WordPress block markup.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.

Steps:

1. Read `templateMappings` from `neptune-config.json`. Confirm with the user which template or part this run will build.
2. Pull the corresponding design template from Figma with the Figma MCP. Load the `figma:figma-use` skill first.
3. Check `devNotes` in `neptune-config.json` for any context that applies to the template being built.
4. Build the template in WordPress block markup only. Do not fall back to plain HTML at any point.
5. For custom styling beyond what core blocks expose:
   - Register new block styles via the theme's block-styles registration function in `functions.php`. The team51 scaffold typically exposes a single function that registers styles — grep `functions.php` for `register_block_style` and follow the existing pattern. Target the registered style slugs from a block stylesheet.
   - Add an SCSS file in `assets/block-styles/src/`, named after the block being styled (e.g. `core-group.scss` for `core/group`). Run `npm run build:styles:block-styles` to compile. The theme handles enqueueing.

   Styling guardrails:
   - Prefer `theme.json` for anything the block APIs expose (colors, font sizes, spacing). See the `theme-json` skill.
   - Use block stylesheets only for styling `theme.json` cannot express.
   - Never put custom CSS directly into `theme.json` or `style.css`.
6. Tell the user the template or part is built, and remind them `/refine-template` is the next step once they can view the rendered output.
