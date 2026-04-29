---
description: Build a single template or template part in the WordPress theme from its mapped Figma design using validated block markup.
model: sonnet
argument-hint: [template-or-part-name] [page-url]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh issue create:*), Bash(gh repo view:*), Bash(npm run build:styles:block-styles), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Bash(curl:*), Skill, mcp__figma__*, mcp__wordpress-studio__*
---

Build the template or template part named in `$ARGUMENTS` for the current Team 51 project. If `$ARGUMENTS` is empty, ask the user which template or part to build from the `templateMappings` in `neptune-config.json`. This command is invoked once per template or part.

Preflight (run before any other step):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted themeJsonCompleted templateMappings themeSlug figmaFileId` — fail fast with a clear message if the user hasn't completed the prior phases. (`patternsCompleted` is **not** required: pattern extraction is optional.)

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`, and (if present) `patterns`.
- The Figma MCP — Figma is the source of truth for the design. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context.
- The `wordpress-studio` MCP — block markup must be validated through `mcp__wordpress-studio__validate_blocks` before being written to disk.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.

After gathering the above context, consider this: Templates are the outer wrapper of content in a WordPress theme. If you're asked, for example, to build the single post template (`single.html`), then you should build its supporting structures and appropriately add the `<!-- wp:post-content /-->` block. The inner content of the template is created in the Post or Page object and will fill this block. You have another command specifically for building this `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md`.

## Styling guardrails

- Prefer `theme.json` for anything the block APIs expose (colors, font sizes, spacing). See the `theme-json` skill.
- Use block stylesheets only for styling `theme.json` cannot express.
- Never put custom CSS directly into `theme.json` or `style.css`.
- Do not use custom CSS classes for styling blocks; instead use the `register_block_style` workflow and either style that block style via `theme.json` or, for custom CSS, use the `.is-style-{styleName}` selector to target the block directly.
- Register new block styles via the theme's block-styles registration function in `functions.php`. The team51 scaffold typically exposes a single function that registers styles — grep `functions.php` for `register_block_style` and follow the existing pattern. Target the registered style slugs from a block stylesheet.
- Add an SCSS file in `assets/block-styles/src/`, named after the block being styled (e.g. `core-group.scss` for `core/group`). Run `npm run build:styles:block-styles` to compile. The theme handles enqueueing.

## Pattern reuse

If `neptune-config.json` has a non-empty `patterns` object, prefer **referencing** patterns over re-emitting their markup. Before generating a section's block markup, scan the `patterns` registry: each entry's `figmaComponentId` and `figmaComponentKey` lets you check whether the Figma node you're about to translate is an instance of a registered component. When it matches, emit `<!-- wp:pattern {"slug":"<fullSlug>"} /-->` and move on instead of re-translating the component's children. This is what keeps repeated sections (feature cards, CTAs, hero rows) consistent across pages — re-emitting the markup per page guarantees drift.

## Block-markup validation (replaces the old wp-blockmarkup MCP)

Every chunk of block markup this command produces — both for the template wrapper and any pattern fallbacks — must be validated by calling `mcp__wordpress-studio__validate_blocks` before being written to disk. If validation reports errors, fix them and re-validate; do not write invalid markup. Do not fall back to plain HTML or `wp:html` to bypass validation — see the building guardrails below.

## Building guardrails

- For any human-actionable follow-up surfaced during this command, open a GitHub issue per the procedure in `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.
- If you're about to use the `wp:html` block to achieve a goal, stop. Add a placeholder paragraph block instead and open an issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` describing what the human needs to wire up.
- When building `header.html` or `footer.html`, wire each navigation item's `href` to a URL from `templateMappings.<entry>.pageUrl` in `neptune-config.json` whenever the nav label matches a mapped template (e.g. a "Blog" nav item → `pageUrl` of the entry that maps to `index.html` or the Blog page template). For nav labels that don't match any mapped entry, leave a placeholder `#` href and open a GitHub issue listing the unwired labels so the user can supply URLs for the missing pages.

## Accessibility, performance, and SEO guardrails

These are non-negotiable for a "production-ready" wrapper. Apply them as you build:

- **Landmarks.** Use semantic block defaults: `core/group` with appropriate tagName for `<header>`, `<main>`, `<footer>`, `<nav>`, `<aside>`. Templates without a `<main>` landmark will fail accessibility audits.
- **Heading hierarchy.** Exactly one `<h1>` per page. Don't skip levels (no `<h2>` directly under `<h1>` if the design has an `<h3>` between them). If the Figma design implies a wrong hierarchy, flag it as a dev-note conflict and open an issue rather than silently fixing it in markup.
- **Image alt text.** Every `core/image` block needs `alt` text; pull it from Figma layer names or component descriptions where possible, otherwise leave an empty alt for decorative images and open an issue listing images that need human-supplied alt text.
- **Lazy-loading.** Below-the-fold images must use `loading="lazy"` (the block attribute `lazyLoad`); above-the-fold hero imagery must use `loading="eager"` and ideally `fetchpriority="high"`.
- **Focus states.** Buttons and links rendered through block stylesheets must have visible `:focus-visible` styles defined in their corresponding `.scss`. Do not rely on browser defaults.
- **Skip link.** Templates that include a header part should ensure the header part includes a `<a class="skip-link" href="#main">` (or equivalent) so keyboard users can jump past navigation.

## Steps

1. Read `templateMappings` from `neptune-config.json`. Each entry's value is an object of the form `{ "wordpressFile": "<path>", "figmaNodes": { "desktop": "<node-id>", "mobile": "<node-id>" }, "pageUrl": "<url>" }` — use `wordpressFile` to locate the file to write. Confirm with the user which template or part this run will build. If multiple entries in `templateMappings` share the same `wordpressFile` (e.g. several page designs all pointing to `page.html`), this command builds the wrapper **once** for that file. Pick the most generic entry's `figmaNodes` to extract the wrapper from (e.g. an entry titled "Default Page" beats "About Page"); ask the user to choose if no entry is obviously generic. The other entries that share this `wordpressFile` are not built here — they're built later via `/build-content`, which fills each page's body using its own `figmaNodes` and `pageUrl`.

2. Pull the Figma design directly via the Figma MCP for every node ID under `figmaNodes` for this mapping. Use `mcp__figma__get_design_context` (with the `figmaFileId` from `neptune-config.json` and the captured node ID) as the primary source — it returns code, a screenshot, and design tokens in one response. Pull both desktop and mobile where present. For template partials like `header.html` or `footer.html`, those layout regions are not stored under their own title card — fetch the full template designs they appear inside and extract the relevant top/bottom region from the Figma design context. Do not skip this step.

3. Filter `devNotes` from `neptune-config.json` to only those whose `context` plausibly applies to the template being built (e.g. notes scoped to "Header" apply to `parts/header.html`; notes scoped to a specific page apply only to that page's wrapper). Reasoning over unrelated notes pollutes the build.

4. Build the template in WordPress block markup only. Reference registered patterns by slug rather than re-emitting their markup (see "Pattern reuse" above). Apply every accessibility/performance/SEO guardrail from the section above as you go. Do not fall back to plain HTML at any point.

5. Validate the generated markup via `mcp__wordpress-studio__validate_blocks` before writing it to disk. If validation fails, fix and re-validate. Only write the validated markup to the target `wordpressFile`.

6. Resolve the `page-url` for this template in this priority order: (a) the `page-url` argument from `$ARGUMENTS` if provided; (b) the `pageUrl` field on this mapping in `templateMappings`, if present; (c) ask the user. If the resolved URL came from the stored `pageUrl`, sanity-check it with a quick `curl -sf -o /dev/null -w '%{http_code}' '<url>'` — a 4xx/5xx means the URL is stale (the page was renamed or the slug changed) and you should re-resolve via WP CLI (`studio wp post list --post_type=any --field=ID --format=ids`) or ask the user. If a URL is resolved by any of those, run this template through the `/refine-template` command — we do this by default to give a better user experience. If no URL is resolved (user declined to provide one), tell the user the template or part is built, and remind them `/refine-template` is the next step once they can view the rendered output.

7. After the template renders successfully, optionally run `mcp__wordpress-studio__rank_me_up` against the resolved URL for an on-page SEO/a11y audit and `mcp__wordpress-studio__need_for_speed` for a Core Web Vitals snapshot. Surface any failures as GitHub issues per the followups procedure. Skip both if no URL was resolved in step 6.

8. If other `templateMappings` entries share this `wordpressFile`, list them at the end with their `pageUrl` values and remind the user to run `/build-content` once per entry to fill the body content for each page. Do not run `/build-content` automatically — content fills are a separate, per-page concern and the user may want to do them in their own order.
