---
name: map-design-templates
description: Confirms each template-mapping candidate (extracted by `pull-figma`) with the user — picks the WordPress theme file each Figma title maps to, captures a preview page URL per mapping, and scaffolds the empty theme files. Used after `pull-figma`. 
---

This skill is the **confirmation and scaffolding** step: walk the user through each title-card candidate, confirm or override the proposed `wordpressFile` and `pageUrl`, and create the empty template files in the theme tree. Do not invoke the `askUserQuestions` helper, as the questions here are more complex and interdependent than that helper can handle.

Reference context:
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme file structure and page-layout file roles.
- `wordpress/.agents/skills/wp-block-themes/references/templates-and-parts.md` — the WordPress template hierarchy.

Multiple Figma title cards can — and often will — map to the same `wordpressFile`. For example, "About Page", "Contact Page", and "Services Page" might all map to `page.html`. That's expected: `page.html` is a thin wrapper (header/footer + `<!-- wp:post-content /-->`), built once per file, while each page's body content lives on the WP_Post and is filled separately by `/build-content` using that entry's own `figmaNodes` and `pageUrl`. Keep one entry per Figma title card — do not collapse them — so per-page content has somewhere to attach.

## Steps

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh figmaPullCompleted templateMappings themeSlug`. If it fails, surface the message and stop.

2. Read `templateMappings` from `neptune-config.json`. Each entry has the shape `{figmaTitleCardId, figmaTitleTextId, figmaNodes: {desktop, mobile?}, proposedWordpressFile}` — produced by `pull-figma`. If an entry already has a confirmed `wordpressFile` (e.g. from a prior run), skip the WP-file question for that entry but still confirm `pageUrl`.

3. Ask the user once for the base site URL where this theme will be tested (e.g. `https://my-site.test`, a local dev URL, or a staging URL). Use it to propose per-template URLs in step 4. If the site does not exist yet, ask whether to skip URL capture for this run; downstream commands will fall back to asking for URLs at build/refine time.

4. **Walk each entry one at a time** — never batch-output a table for the user to review. For each entry:
   - State the Figma title and the proposed WordPress file.
   - Propose a preview page URL based on convention:
     - `front-page.html` → `<base>/`
     - `index.html` (blog landing or default posts list) → `<base>/blog` or `<base>/`
     - `single.html` → ask the user for an example published post URL
     - `archive.html` / `category.html` → `<base>/blog` or `<base>/category/<slug>`
     - `search.html` → `<base>/?s=example`
     - `404.html` → `<base>/this-page-does-not-exist`
     - `page.html` and custom page templates → ask for the slug of the page that uses this template
     - `parts/header.html`, `parts/footer.html` → reuse the URL of any full template the part renders in (the homepage URL is a sensible default)
   - Ask the user to confirm both the WordPress file and the page URL together. Example: "Figma title 'Blog' — proposed `index.html`, page URL `https://my-site.test/blog`. OK with both?"
   - If the user changes either, update the entry. Create any pages referenced that don't currently exist using WP CLI at `studio wp` (e.g. `studio wp post create --post_type=page --post_title='About' --post_status=publish --porcelain`). For any human-actionable follow-up surfaced during this skill, open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.
   - For any entry where `figmaNodes.mobile` is missing, ask the user to confirm whether the design genuinely has only one breakpoint, or whether the mobile frame was missed during the pull (in which case prompt them to share its node-id URL — the user copies a link to the mobile frame in Figma, and the skill extracts the node-id).

5. Always ensure entries for `parts/header.html` and `parts/footer.html` exist in `templateMappings`, even if `pull-figma` didn't find dedicated title cards for them. Most designs have a header and footer that aren't called out as separate title cards — the layout regions usually live inside the page templates instead. Ask the user to share Figma node-id URLs for the header and footer regions for desktop and mobile, validate, and write them as new entries with `wordpressFile: parts/header.html` / `parts/footer.html`.

6. Write the confirmed `templateMappings` back to `neptune-config.json` (same key; recursive-merge so other config slices are untouched). Each entry now carries:
   ```json
   {
     "wordpressFile": "<path relative to the theme root>",
     "figmaTitleCardId": "<unchanged>",
     "figmaTitleTextId": "<unchanged>",
     "figmaNodes": { "desktop": "...", "mobile": "..." },
     "pageUrl": "<full URL>",
     "proposedWordpressFile": "<unchanged — kept for traceability>"
   }
   ```

7. Create each mapped template file under the theme (use `themeSlug` from `neptune-config.json`). Templates live under `wordpress/wp-content/themes/<themeSlug>/templates/`; template parts live under `wordpress/wp-content/themes/<themeSlug>/parts/` and should be scaffolded empty. **If a target file already exists and is non-empty, leave it alone** — never truncate a partially-built template on a re-run. List any files skipped this way in the run summary so the user can see what was preserved. Do not populate the files with block markup yet — that happens in `/build-template`. Do not write to `theme.json` from this skill; the next skill, `theme-json`, registers the resulting template parts and custom templates there.

8. Before finishing, list:
   - Any mappings that ended up without a `figmaNodes.mobile` (and whether the user confirmed the design is desktop-only).
   - Any mappings without a `pageUrl` (and the warning that nav wiring during `/build-template` will need manual URL supply for those).
   - Groups of entries that share the same `wordpressFile` (e.g. all entries pointing to `page.html`) so the user knows `/build-template` will run once per file while `/build-content` will run per entry.

9. Set `templateMappingsCompleted: true` in `neptune-config.json` (alongside the `templateMappings` object). The boolean is the completion signal; the data lives under `templateMappings`.

10. Load and follow the `theme-json` skill to continue.
