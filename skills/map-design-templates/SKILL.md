---
name: map-design-templates
description: Map Figma `🗒️ Templates` title cards to WordPress block-theme files, confirm each mapping with the user, scaffold the empty template files, capture the Figma node IDs for each desktop/mobile layout, and capture the page URL where each template renders so later build/refine/content commands and header/footer nav wiring can reuse them without re-asking. Use after dev-notes; the next skill, `theme-json`, registers the resulting parts and custom templates in `theme.json`.
---

In the Figma file, the `🗒️ Templates` layer contains a `Title Card` sublayer per design template; the title card text identifies the page the layout represents (e.g. `Title Card - Home` → the homepage). Beneath each title card there are usually two layout frames: a wider one (desktop) and a narrower one (mobile).

Figma is the source of truth for the design. Pull every layout directly through the Figma MCP — never rely on local screenshot exports.

Reference context:
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme file structure and page-layout file roles.
- `wordpress/.agents/skills/wp-block-themes/references/templates-and-parts.md` — the WordPress template hierarchy.

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

Multiple Figma title cards can — and often will — map to the same `wordpressFile`. For example, "About Page", "Contact Page", and "Services Page" might all map to `page.html`. That's expected: `page.html` is a thin wrapper (header/footer + `<!-- wp:post-content /-->`), built once per file, while each page's body content lives on the WP_Post and is filled separately by `/build-content` using that entry's own `figmaNodes` and `pageUrl`. Keep one entry per Figma title card — do not collapse them — so per-page content has somewhere to attach.

Steps:

1. Load the `figma:figma-use` skill first. Use the Figma MCP to walk the `🗒️ Templates` layer of the `🛠️  Dev Handoff` page and gather every `Title Card` with its child layout frames. For each title card, capture the title text plus the node ID of every layout frame beneath it (typically a desktop frame and a mobile frame; sometimes more).
2. Ask the user once for the base site URL where this theme will be tested (e.g. `https://my-site.test`, a local dev URL, or a staging URL). Use it to propose per-template URLs in step 4. If the site does not exist yet, ask whether to skip URL capture for this run; downstream commands will fall back to asking for URLs at build/refine time.
3. For each design template, propose a mapping to a WordPress theme file based on the table above and the template hierarchy reference.
4. Confirm each mapping with the user one at a time. Do not output a table of all your findings. Move through your findings one prompt at a time. For each template, propose **both** the WordPress file and a page URL based on convention, then confirm both before moving on. Example: "Figma has a template called `Blog`. I'd map this to `index.html`, with the page URL `https://my-site.test/`. OK with both?" URL conventions to propose:
   - `index.html` → `<base>/`
   - `single.html` → ask the user for an example published post URL (the canonical post used to preview the single template)
   - `archive.html` / `category.html` → `<base>/blog` or `<base>/category/<slug>` (ask if unsure)
   - `search.html` → `<base>/?s=example`
   - `404.html` → `<base>/this-page-does-not-exist` (or any deliberately broken slug)
   - `page.html` and custom page templates → ask for the slug of the page that uses this template
   - `header.html`, `footer.html` → reuse the URL of any full template the part renders in (the homepage URL is a sensible default)
   Update mappings based on user feedback before moving on. If you have any follow-ups for the user, which are direct human actionable tasks. Open an issue for each on GitHub in the project repo, and link to the relevant section of the Figma file or the specific dev note that inspired the task. You'll use `gh issue create` for this, and you can find the repository URL and theme slug in `neptune-config.json` to construct the command. Note in the body text that the issue was create by Neptune.
5. Record confirmed mappings under a `templateMappings` object in `neptune-config.json`, keyed by Figma template name. Each value is an object:
   ```json
   {
     "wordpressFile": "<path relative to the theme root>",
     "figmaNodes": {
       "desktop": "<figma-node-id>",
       "mobile": "<figma-node-id>"
     },
     "pageUrl": "<full URL where this template renders>"
   }
   ```
   Use the layout frame's aspect ratio or width to decide which frame is `desktop` vs `mobile`. If the title card has only one layout frame, record it under `desktop` and omit `mobile`. If there are additional named breakpoints, add further keys (e.g. `tablet`) using the same convention. When confirming each mapping with the user, also confirm the desktop/mobile assignment for any case that is ambiguous. If the user opted to skip URL capture for a mapping (or for the whole run in step 2), omit `pageUrl` for that entry — downstream commands will treat its absence as "ask the user at run time."
6. Create each mapped template file empty, in the correct directory under the theme (use `themeSlug` from `neptune-config.json`). Do not populate the files with block markup yet — that happens in `/build-template`. Do not write to `theme.json` from this skill; the next skill, `theme-json`, reads `templateMappings` from `neptune-config.json` and registers the resulting template parts and custom templates there.
7. Before finishing, list any title cards in `🗒️ Templates` whose layout frames could not be resolved into clean `desktop` / `mobile` assignments, any mappings that ended up without a `figmaNodes` entry, and any mappings without a `pageUrl`. Ask the user how to handle these — do not auto-resolve. Mention that captured `pageUrl` values double as the URL pool for header/footer nav wiring during `/build-template`, so leaving them empty means nav items will need to be wired manually later. Also list groups of entries that share the same `wordpressFile` (e.g. all entries pointing to `page.html`) so the user knows `/build-template` will run once for that file while `/build-content` will run per entry.

8. Tell the user mappings have been recorded and the next skill in the flow is `theme-json`, which will generate `theme.json` and register the template parts and custom templates from `templateMappings`.
