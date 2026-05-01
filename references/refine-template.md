# Refine template reference

Refine the template or template part named in `$ARGUMENTS`, using the site URL the user also supplies in `$ARGUMENTS` for visual testing. Resolve the site URL in this priority order: (a) the URL passed in `$ARGUMENTS`; (b) the `pageUrl` field on this template's entry in `templateMappings` from `neptune-config.json`, if present; (c) ask the user. If `$ARGUMENTS` is empty, ask the user for:

- Which template or template part to refine (from `templateMappings` in `neptune-config.json`).
- The URL where the local or staging site can be reached, only if the matching `templateMappings` entry has no `pageUrl`.

Figma is the source of truth for the design. Adjust the WordPress template to match Figma — never the other way around.

Preflight (run before any other step):

- `${CLAUDE_PLUGIN_ROOT}/scripts/check-state.sh templateMappingsCompleted themeJsonCompleted templateMappings themeSlug figmaFileId` — fail fast if prior phases are incomplete.

Context to load before starting:
- `neptune-config.json` — `themeSlug`, `templateMappings`, `devNotes`, `figmaFileId`.
- The Figma MCP — Figma is the source of truth. Load the `figma:figma-use` skill before any Figma MCP calls that need JS execution in the file context. Pull the file's variable values via a `use_figma` JS call when reasoning numerically about tokens.
- `${CLAUDE_PLUGIN_ROOT}/references/reading-design-context.md` — translation contract for `mcp__figma__get_design_context` output. Apply it whenever you compare the Figma side of the diff against rendered markup; the same blueprint-not-literal rules govern what counts as a real discrepancy vs. a React/Tailwind artefact.
- The `wordpress-studio` MCP — use `take_screenshot` for the rendered shot, `validate_blocks` for any block-markup edits, and `wp_cli` for runtime introspection.
- `wordpress/.agents/skills/wp-block-themes/SKILL.md` — block theme structure and theme.json reference.
- `${CLAUDE_PLUGIN_ROOT}/references/build-guardrails.md` — every styling, validation, building, and accessibility/performance/SEO guardrail there applies to refinement edits the same way it applies to the initial build.
- `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` — allow-list of blocks; any markup change must stay inside it.
- `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` — `theme.json` keys; any token-level change must respect this contract.
- For any human-actionable follow-up surfaced during this command, open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`.

## Diff strategy: measure first, vision second

LLM vision is unreliable for sub-10px spacing deltas and for telling apart neighbouring font-weights. This procedure runs the diff in two stages — numeric measurement first, vision second — and trusts numeric measurements over visual impressions when they conflict.

**Stage A (numeric).** For each region under refinement:

1. Pull the Figma node's measured properties via `mcp__figma__get_design_context`, and pull the file's variable definitions via `use_figma` (load the `figma:figma-use` skill first). Record the relevant numbers: width / height, padding/margin per side, gap, font-family, font-size (computed in px), font-weight, line-height, letter-spacing, color values (resolved from variables). For tokens, record both the token name and its concrete value at the matching mode.
2. Pull the rendered DOM's computed styles for the same region via `studio wp_cli`. There are two ways to do this — the cheaper one is to inject a small evaluation script into the rendered page through `studio wp eval-file` against a helper that uses `WP_HTML_Tag_Processor` on the saved template, but for layout-affecting numbers you usually want browser-side computed styles. Get those by pointing the Studio screenshot tool at the URL with a probe selector and reading the screenshot back as the visual reference, plus parsing the rendered HTML directly from `curl` to confirm DOM structure. If `getComputedStyle`-equivalent introspection isn't reliably available, fall back to (a) the values declared in `theme.json`, (b) the values written into block stylesheets, and (c) the `style=` attributes serialised on each block by the block editor. These three sources together cover the vast majority of layout decisions in a block theme.
3. Compute the deltas as numbers. Anything outside ±1px on layout, ±2% on color (perceptual), or any difference in `font-weight` / `font-family` / token name is a discrepancy.

**Stage B (visual).** Take the rendered screenshot and the Figma screenshot at matching breakpoints and compare visually for things numbers don't catch: alignment, z-order, missing/extra elements, overflow, broken responsive behaviour. Vision discrepancies are valid; vision *measurements* are not. If a vision impression contradicts a numeric measurement, trust the number.

The discrepancy table the user sees lists Stage A and Stage B findings together with a `source` column (`measured` vs `visual`) so the human knows which is which.

## Steps

1. Take a screenshot of the rendered template at the resolved site URL via `mcp__wordpress-studio__take_screenshot`. Take one screenshot per breakpoint you intend to refine against (desktop and mobile widths) — `take_screenshot` accepts a viewport argument. Record which breakpoint each screenshot represents.

2. Read the corresponding entry from `templateMappings` in `neptune-config.json`. Each value is an object of the form `{ "wordpressFile": "<path>", "figmaNodes": { "desktop": "<node-id>", "mobile": "<node-id>" }, "pageUrl": "<url>" }`. If `figmaNodes` is missing or empty for this mapping, stop and ask the user to re-run `map-design-templates` so the Figma node IDs are captured before continuing. If multiple `templateMappings` entries share this entry's `wordpressFile`, this run refines the **wrapper** for that file using this entry's `figmaNodes` and `pageUrl`. The other sibling entries' page-specific designs are concerns for `/build-content` and its own refinement, not this one.

3. Pull the Figma design directly via the Figma MCP — call `mcp__figma__get_design_context` (and `mcp__figma__get_screenshot` if you need a separate image) using `figmaFileId` from `neptune-config.json` and the relevant node ID under `figmaNodes`. Match the breakpoint of the rendered screenshot you took in step 1: use the `desktop` node for a desktop-width screenshot, the `mobile` node for a mobile-width screenshot. If both are available and relevant, refine against each in turn. Also pull the file's variable definitions once via a `use_figma` JS call — its output feeds Stage A's numeric comparison. Do not skip these calls.

4. Run Stage A (numeric) and Stage B (visual) per the strategy above. Produce a single discrepancy table with columns: `region` | `property` | `figma` | `rendered` | `source` (`measured` / `visual`) | `severity`. Share it with the user before making changes.

5. Apply refinements to resolve each discrepancy — edits to block markup, `theme.json`, or block stylesheets as appropriate. For any block-markup change, validate the new markup with `mcp__wordpress-studio__validate_blocks` before writing it. For changes that should live in `theme.json` (token values, spacing scale entries) prefer editing `theme.json` over inlining `style=` attributes on individual blocks. For changes that need custom CSS, use the `register_block_style` workflow + an SCSS file in `assets/block-styles/src/`, then `npm run build:styles:block-styles`.

6. Re-take the screenshot from step 1 at the same breakpoint(s) and confirm the discrepancies have been resolved. Iterate steps 4–5 until either every in-scope discrepancy is resolved or you've reached a point where remaining differences need human input — open a GitHub issue describing what's blocked.
