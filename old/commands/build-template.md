---
description: Build a single template or template part in the WordPress theme from its mapped Figma design using validated block markup.
argument-hint: [template-or-part-name] [page-url]
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(gh issue create:*), Bash(gh repo view:*), Bash(npm run build:styles:block-styles), Bash(${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh:*), Bash(curl:*), Skill, mcp__figma__*, mcp__wordpress-studio__*
---

Build the template or template part named in `$ARGUMENTS` for the current Team 51 project. If `$ARGUMENTS` is empty, ask the user which template or part to build from the `templateMappings` in `neptune-config.json`. This command is invoked once per template or part.

Preflight (run before any other step):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted themeJsonCompleted templateMappings themeSlug figmaFileId` — fail fast with a clear message if the user hasn't completed the prior phases.

Context to load before starting:
- `neptune-config.json` at the project root — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- The Figma MCP — Figma is the source of truth for the design. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context.
- `${CLAUDE_PLUGIN_ROOT}/references/reading-design-context.md` — translation contract for `mcp__figma__get_design_context` output. Apply it for every Figma node you read in this run; treat the React+Tailwind response as a structural blueprint, not literal code.
- The `wordpress-studio` MCP — block markup must be validated through `mcp__wordpress-studio__validate_blocks` before being written to disk.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.

After gathering the above context, consider this: Templates are the outer wrapper of content in a WordPress theme. If you're asked, for example, to build the single post template (`single.html`), then you should build its supporting structures and appropriately add the `<!-- wp:post-content /-->` block. The inner content of the template is created in the Post or Page object and will fill this block. You have another command specifically for building this `${CLAUDE_PLUGIN_ROOT}/commands/build-content.md`.

## Guardrails

Read these before emitting any markup. They are the single source of truth — do not duplicate or paraphrase them in this file.

- `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md` — styling, block-markup validation, building, and accessibility/performance/SEO rules. Every guardrail there applies to this command.
- `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` — the allow-list of blocks Neptune is permitted to emit, with attribute syntax for each.
- `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` — the `theme.json` keys to resolve preset references against.

## Steps

1. Read `templateMappings` from `neptune-config.json`. Each entry's value is an object of the form `{ "wordpressFile": "<path>", "figmaNodes": { "desktop": "<node-id>", "mobile": "<node-id>" }, "pageUrl": "<url>" }` — use `wordpressFile` to locate the file to write. Confirm with the user which template or part this run will build. If multiple entries in `templateMappings` share the same `wordpressFile` (e.g. several page designs all pointing to `page.html`), this command builds the wrapper **once** for that file. Pick the most generic entry's `figmaNodes` to extract the wrapper from (e.g. an entry titled "Default Page" beats "About Page"); ask the user to choose if no entry is obviously generic. The other entries that share this `wordpressFile` are not built here — they're built later via `/build-content`, which fills each page's body using its own `figmaNodes` and `pageUrl`.

2. Pull the Figma design directly via the Figma MCP for every node ID under `figmaNodes` for this mapping. Use `mcp__figma__get_design_context` (with the `figmaFileId` from `neptune-config.json` and the captured node ID) as the primary source — it returns code, a screenshot, and design tokens in one response. Pull both desktop and mobile where present. For template partials like `header.html` or `footer.html`, those layout regions are not stored under their own title card — fetch the full template designs they appear inside and extract the relevant top/bottom region from the Figma design context. Do not skip this step.

3. Filter `devNotes` from `neptune-config.json` to only those whose `context` plausibly applies to the template being built (e.g. notes scoped to "Header" apply to `parts/header.html`; notes scoped to a specific page apply only to that page's wrapper). Reasoning over unrelated notes pollutes the build.

4. Build the template in WordPress block markup only, using the blocks listed in `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` and the preset slugs declared in `theme.json`. Apply every guardrail in `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md` as you go.

5. Validate the generated markup via `mcp__wordpress-studio__validate_blocks` before writing it to disk. If validation fails, fix and re-validate. Only write the validated markup to the target `wordpressFile`. Cross-file properties (template-part slug references, preset resolution, `templateParts` registration, required blocks per template slug) are not covered by `validate_blocks` — verify them against `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` and `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` before continuing.

6. Resolve the `page-url` for this template in this priority order: (a) the `page-url` argument from `$ARGUMENTS` if provided; (b) the `pageUrl` field on this mapping in `templateMappings`, if present; (c) ask the user. If the resolved URL came from the stored `pageUrl`, sanity-check it with a quick `curl -sf -o /dev/null -w '%{http_code}' '<url>'` — a 4xx/5xx means the URL is stale (the page was renamed or the slug changed) and you should re-resolve via WP CLI (`studio wp post list --post_type=any --field=ID --format=ids`) or ask the user.

7. If other `templateMappings` entries share this `wordpressFile`, list them at the end with their `pageUrl` values and remind the user to run `/build-content` once per entry to fill the body content for each page. Do not run `/build-content` automatically — content fills are a separate, per-page concern and the user may want to do them in their own order.

8. If a URL was resolved in step 6, read `${CLAUDE_PLUGIN_ROOT}/references/refine-template.md` and follow it end-to-end for this template, treating the resolved URL as the site URL. If no URL was resolved, tell the user the template or part is built and remind them to run `/refine-template` once they can view the rendered output.
