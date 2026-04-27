---
name: map-design-templates
description: Map Figma `🗒️ Templates` title cards to WordPress block-theme files, confirm each mapping with the user, scaffold the empty template files, register parts in theme.json, and capture the Figma node IDs for each desktop/mobile layout so later commands can fetch designs directly from Figma. Use after theme-json.
---

In the Figma file, the `🗒️ Templates` layer contains a `Title Card` sublayer per design template; the title card text identifies the page the layout represents (e.g. `Title Card - Home` → the homepage). Beneath each title card there are usually two layout frames: a wider one (desktop) and a narrower one (mobile).

Figma is the source of truth for the design. Pull every layout directly through the Figma MCP — never rely on local screenshot exports.

Reference context:
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme file structure and page-layout file roles.
- `wordpress/.agents/skills/wp-block-themes/references/templates-and-parts.md` — the WordPress template hierarchy.
- `wordpress/.agents/skills/wp-block-themes/references/theme-json.md` — how to register template parts and custom templates in theme.json.

Typical mappings:

| Design Template Name              | WordPress Theme File                                                 |
| ---                               | ---                                                                  |
| Blog                              | `index.html`                                                         |
| Category                          | `archive.html` or `category.html` (if a category-specific layout)    |
| Blog Post                         | `single.html`                                                        |
| Search Results                    | `search.html`                                                        |
| 404 Page                          | `404.html`                                                           |
| Default Page                      | `page.html`                                                          |
| Other pages (e.g. About, Contact) | `page.html` or a custom full-width page template for Gutenberg edits |

Steps:

1. Load the `figma:figma-use` skill first. Use the Figma MCP to walk the `🗒️ Templates` layer of the `🛠️  Dev Handoff` page and gather every `Title Card` with its child layout frames. For each title card, capture the title text plus the node ID of every layout frame beneath it (typically a desktop frame and a mobile frame; sometimes more).
2. For each design template, propose a mapping to a WordPress theme file based on the table above and the template hierarchy reference.
3. Confirm each mapping with the user one at a time. Do not output a table of all your findings. Move through your findings one prompt at a time. Example: "Figma has a template called `Blog`. I'd map this to `index.html`. OK with that?" Update mappings based on user feedback before moving on. If you have any follow-ups for the user, which are direct human actionable tasks. Open an issue for each on GitHub in the project repo, and link to the relevant section of the Figma file or the specific dev note that inspired the task. You'll use `gh issue create` for this, and you can find the repository URL and theme slug in `neptune-config.json` to construct the command. Note in the body text that the issue was create by Neptune.
4. Record confirmed mappings under a `templateMappings` object in `neptune-config.json`, keyed by Figma template name. Each value is an object:
   ```json
   {
     "wordpressFile": "<path relative to the theme root>",
     "figmaNodes": {
       "desktop": "<figma-node-id>",
       "mobile": "<figma-node-id>"
     }
   }
   ```
   Use the layout frame's aspect ratio or width to decide which frame is `desktop` vs `mobile`. If the title card has only one layout frame, record it under `desktop` and omit `mobile`. If there are additional named breakpoints, add further keys (e.g. `tablet`) using the same convention. When confirming each mapping with the user, also confirm the desktop/mobile assignment for any case that is ambiguous.
5. Create each mapped template file empty, in the correct directory under the theme (use `themeSlug` from `neptune-config.json`). Register template parts and custom templates in `theme.json` as you create their files, so they are available in the block editor. Do not populate the files with block markup yet — that happens in `/build-template`.
6. Before finishing, list any title cards in `🗒️ Templates` whose layout frames could not be resolved into clean `desktop` / `mobile` assignments, and any mappings that ended up without a `figmaNodes` entry. Ask the user how to handle these — do not auto-resolve.
