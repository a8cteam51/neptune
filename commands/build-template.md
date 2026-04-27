---
description: Build a single template or template part in the WordPress theme from its mapped Figma design using block markup.
argument-hint: [template-or-part-name] [page-url]
---

Build the template or template part named in `$ARGUMENTS` for the current Team 51 project. If `$ARGUMENTS` is empty, ask the user which template or part to build from the `templateMappings` in `neptune-config.json`. This command is invoked once per template or part.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`.
- The `wp-blockmarkup` MCP — use it to generate WordPress block markup.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.

After gathering the above context, consider this: Templates are the outer wrapper of content in a WordPress theme. If you're asked, for example, to build the single post template (`single.html`), then you should build its supporting structures and appropriately add the `<!-- wp:post-content /-->` block. The inner content of the template is created in the Post or Page object and will fill this block. You have another command specifically for building this `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md`.

Steps:

1. Read `templateMappings` from `neptune-config.json`. Each entry's value is an object of the form `{ "wordpressFile": "<path>", "screenshot": "<path or null>" }` — use `wordpressFile` to locate the file to write. Confirm with the user which template or part this run will build.
2. Load the screenshots for this template file based on the Neptune config template mappings. Use these to define your build. If you're asked to work on a template partial like `header.html` or `footer.html` you'll find those at the top and bottom of multiple screenshots. 
3. Check `devNotes` in `neptune-config.json` for any context that applies to the template being built.
4. Build the template in WordPress block markup only. Do not fall back to plain HTML at any point.
5. For custom styling beyond what core blocks expose:
   - Register new block styles via the theme's block-styles registration function in `functions.php`. The team51 scaffold typically exposes a single function that registers styles — grep `functions.php` for `register_block_style` and follow the existing pattern. Target the registered style slugs from a block stylesheet.
   - Add an SCSS file in `assets/block-styles/src/`, named after the block being styled (e.g. `core-group.scss` for `core/group`). Run `npm run build:styles:block-styles` to compile. The theme handles enqueueing.

   Styling guardrails:
   - Prefer `theme.json` for anything the block APIs expose (colors, font sizes, spacing). See the `theme-json` skill.
   - Use block stylesheets only for styling `theme.json` cannot express.
   - Never put custom CSS directly into `theme.json` or `style.css`.
6. If a `page-url` argument is provided, go ahead and run this template part and page URL through the `/refine-template` command, we should do this by default to give a better user experience. If no `page-url` was provided; tell the user the template or part is built, and remind them `/refine-template` is the next step once they can view the rendered output.
