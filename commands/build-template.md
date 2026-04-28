---
description: Build a single template or template part in the WordPress theme from its mapped Figma design using block markup.
argument-hint: [template-or-part-name] [page-url]
---

Build the template or template part named in `$ARGUMENTS` for the current Team 51 project. If `$ARGUMENTS` is empty, ask the user which template or part to build from the `templateMappings` in `neptune-config.json`. This command is invoked once per template or part.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`.
- The `wp-blockmarkup` MCP — use it to generate WordPress block markup.
- The Figma MCP — Figma is the source of truth for the design. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.

After gathering the above context, consider this: Templates are the outer wrapper of content in a WordPress theme. If you're asked, for example, to build the single post template (`single.html`), then you should build its supporting structures and appropriately add the `<!-- wp:post-content /-->` block. The inner content of the template is created in the Post or Page object and will fill this block. You have another command specifically for building this `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md`.

Styling guardrails:
   - Prefer `theme.json` for anything the block APIs expose (colors, font sizes, spacing). See the `theme-json` skill.
   - Use block stylesheets only for styling `theme.json` cannot express.
   - Never put custom CSS directly into `theme.json` or `style.css`.
   - Do not use custom CSS classes for styling blocks, instead use the `register_block_style` workflow and then either style that block style via `theme.json` or, for custom CSS, use `.is-style-{styleName}` selector to target the block directly.
   - Register new block styles via the theme's block-styles registration function in `functions.php`. The team51 scaffold typically exposes a single function that registers styles — grep `functions.php` for `register_block_style` and follow the existing pattern. Target the registered style slugs from a block stylesheet.
   - Add an SCSS file in `assets/block-styles/src/`, named after the block being styled (e.g. `core-group.scss` for `core/group`). Run `npm run build:styles:block-styles` to compile. The theme handles enqueueing.

Building guardrails:
	- If you have any follow-ups for the user, which are direct human actionable tasks. Open an issue for each on GitHub in the project repo, and link to the relevant section of the Figma file or the specific dev note that inspired the task. You'll use `gh issue create` for this, and you can find the repository URL and theme slug in `neptune-config.json` to construct the command. Note in the body text that the issue was create by Neptune.
	- If you're about to use the `wp:html` block to acheive a goal, stop. Add a placeholder comment via a paragraph block instead and then create a GitHub issue outlining to the Human what needs to be done.
	- When building `header.html` or `footer.html`, wire each navigation item's `href` to a URL from `templateMappings.<entry>.pageUrl` in `neptune-config.json` whenever the nav label matches a mapped template (e.g. a "Blog" nav item → `pageUrl` of the entry that maps to `index.html` or the Blog page template). For nav labels that don't match any mapped entry, leave a placeholder `#` href and open a GitHub issue listing the unwired labels so the user can supply URLs for the missing pages.
	- For every `<!-- wp:image -->` block (or any block with an image attribute, e.g. `<!-- wp:cover -->`, `<!-- wp:media-text -->`), look up the source image in `figmaAssets` from `neptune-config.json`. The Figma design context for this template references images by node ID and / or image hash; match against `figmaAssets.<hash>.figmaNodeIds` (or by hash directly when available) and use the matched entry's `wpAttachmentId` for the `id` attribute, `wpUrl` for the `src`, and `altText` for the `alt`. If no `figmaAssets` entry matches an image you need, stop and tell the user to (re-)run `download-assets` to capture it — do **not** invent placeholder image URLs and do not embed Figma URLs directly.

Steps:

1. Read `templateMappings` from `neptune-config.json`. Each entry's value is an object of the form `{ "wordpressFile": "<path>", "figmaNodes": { "desktop": "<node-id>", "mobile": "<node-id>" }, "pageUrl": "<url>" }` — use `wordpressFile` to locate the file to write. Confirm with the user which template or part this run will build. If multiple entries in `templateMappings` share the same `wordpressFile` (e.g. several page designs all pointing to `page.html`), this command builds the wrapper **once** for that file. Pick the most generic entry's `figmaNodes` to extract the wrapper from (e.g. an entry titled "Default Page" beats "About Page"); ask the user to choose if no entry is obviously generic. The other entries that share this `wordpressFile` are not built here — they're built later via `/build-content`, which fills each page's body using its own `figmaNodes` and `pageUrl`.
2. Pull the Figma design directly via the Figma MCP for every node ID under `figmaNodes` for this mapping. Use `mcp__figma__get_design_context` (with the `figmaFileId` from `neptune-config.json` and the captured node ID) as the primary source — it returns code, a screenshot, and design tokens in one response. Pull both desktop and mobile where present. For template partials like `header.html` or `footer.html`, those layout regions are not stored under their own title card — fetch the full template designs they appear inside and extract the relevant top/bottom region from the Figma design context. Do not skip this step, it is important that this runs exactly as described to ensure you're building from our designs.
3. Check `devNotes` in `neptune-config.json` for any context that applies to the template being built.
4. Build the template in WordPress block markup only. Do not fall back to plain HTML at any point.
5. Resolve the `page-url` for this template in this priority order: (a) the `page-url` argument from `$ARGUMENTS` if provided; (b) the `pageUrl` field on this mapping in `templateMappings`, if present; (c) ask the user. If a URL is resolved by any of those, run this template through the `/refine-template` command — we do this by default to give a better user experience. If no URL is resolved (user declined to provide one), tell the user the template or part is built, and remind them `/refine-template` is the next step once they can view the rendered output.
6. If other `templateMappings` entries share this `wordpressFile`, list them at the end with their `pageUrl` values and remind the user to run `/build-content` once per entry to fill the body content for each page. Do not run `/build-content` automatically — content fills are a separate, per-page concern and the user may want to do them in their own order.
