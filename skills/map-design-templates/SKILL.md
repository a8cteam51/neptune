---
name: map-design-templates
description: Map Figma `🗒️ Templates` title cards to WordPress block-theme files, confirm each mapping with the user, scaffold the empty template files, register parts in theme.json, and link user-exported screenshots in the `screenshots/` directory to each mapping. Use after theme-json.
---

In the Figma file, the `🗒️ Templates` layer contains a `Title Card` sublayer per design template; the title card text identifies the page the layout represents (e.g. `Title Card - Home` → the homepage). Beneath each title card there are usually two layout frames: a wider one (desktop) and a narrower one (mobile).

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

1. Use the Figma MCP to gather the design templates from the `🗒️ Templates` layer of the `🛠️  Dev Handoff` page. Load the `figma:figma-use` skill first. Template titles are in each `Title Card` sublayer.
2. For each design template, propose a mapping to a WordPress theme file based on the table above and the template hierarchy reference.
3. Confirm each mapping with the user one at a time. Do not output a table of all your findings. Move through your findings one prompt at a time. Example: "Figma has a template called `Blog`. I'd map this to `index.html`. OK with that?" Update mappings based on user feedback before moving on. If you have any follow-ups for the user, which are direct human actionable tasks. Open an issue for each on GitHub in the project repo, and link to the relevant section of the Figma file or the specific dev note that inspired the task. You'll use `gh issue create` for this, and you can find the repository URL and theme slug in `neptune-config.json` to construct the command. Note in the body text that the issue was create by Neptune.
4. Record confirmed mappings under a `templateMappings` object in `neptune-config.json`, keyed by Figma template name. Each value is an object:
   ```json
   {
     "wordpressFile": "<path relative to the theme root>",
     "screenshot": null
   }
   ```
   The `screenshot` field is filled in by step 6.
5. Create each mapped template file empty, in the correct directory under the theme (use `themeSlug` from `neptune-config.json`). Register template parts and custom templates in `theme.json` as you create their files, so they are available in the block editor. Do not populate the files with block markup yet — that happens in `/build-template`.
6. Match user-exported screenshots in `screenshots/` to template mappings:
   - The user is expected to have manually exported design templates from Figma at 1x PNG into the `screenshots/` directory at the project root (this is set up by `setup-project`). If the directory is missing or empty, stop and tell the user to complete the export before re-running this skill.
   - In `templateMappings` the `screenshot` field is currently null for each mapping. Note that this should become an object as you populate it. The object should contain pairs where the key is a layout descriptor (e.g. "desktop", "mobile") and the value is the screenshot path relative to the project root (e.g. `screenshots/blog-desktop.png`).
   - List every file in `screenshots/`. For each file, attempt to map it to a template mapping based on filename similarity (e.g. `blog-post.png` → `Blog Post` template). For every screenshot whose slug matches a `templateMappings` slug, set `screenshot` on that entry to the screenshot path relative to the project root (e.g. `screenshots/blog.png`). It's likely there will be multiple screenshots per template (e.g. `blog-desktop.png`, `blog-mobile.png`) — if so, you can either ask the user to confirm which mapping each screenshot belongs to, or apply a consistent heuristic (e.g. if the filename contains "desktop", link it to the desktop layout of the template; if it contains "mobile", link it to the mobile layout).
   - For every screenshot whose slug matches a `templateMappings` slug, set `screenshot` on that entry to the screenshot path relative to the project root (e.g. `screenshots/blog.png`).
   - Persist the updated `templateMappings` back to `neptune-config.json`.
   - Report two lists to the user before finishing: screenshots in `screenshots/` that did not match any mapping, and template mappings that have no screenshot. Ask the user whether to rename, re-export, or leave unmatched entries as-is — do not auto-resolve.
