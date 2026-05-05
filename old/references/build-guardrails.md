# Build & refine guardrails

Authoritative source for the rules every build / refine command must apply when emitting block markup, editing `theme.json`, or writing block stylesheets. The per-command files (`commands/build-template.md`, `commands/build-content.md`, `references/refine-template.md`, `references/refine-content.md`, `commands/build-all-templates.md`) point at this file rather than carrying their own copies, so the rules cannot drift between build and refine.

If a guardrail can't be applied as written for a specific case, file a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` and leave a placeholder block — never silently relax the rule.

## Styling

- **Tokens before custom CSS.** Use `theme.json` for anything the block APIs expose: colors, font families, font sizes, line heights, spacing, layout sizes. `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` documents the exact subset Neptune reads and writes.
- **Block stylesheets only for what `theme.json` cannot express.** Add an SCSS file in `assets/block-styles/src/`, named after the block being styled (`core-group.scss` for `core/group`). Run `npm run build:styles:block-styles` to compile. The Team51 scaffold handles enqueueing.
- **Never** put custom CSS directly in `theme.json` or `style.css`.
- **No custom CSS classes.** Use `register_block_style` and target the registered style via `theme.json` `styles.blocks.<block>.variations.<style>` or, when custom CSS is unavoidable, the `.is-style-{styleName}` selector inside the block's SCSS file.
- **Register new block styles via the theme's existing helper in `functions.php`.** Grep `functions.php` for `register_block_style` and follow the existing pattern; do not introduce a parallel registration path.

## Block-markup validation

- Every chunk of block markup produced by a build or refine command **must** pass `mcp__wordpress-studio__validate_blocks` before being written to disk or pushed to a post via WP CLI. Fix and re-validate on failure; never write invalid markup.
- The authoritative list of blocks Neptune is allowed to emit lives at `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md`. Anything outside that list — including `wp:html`, custom blocks, third-party blocks, or shortcodes inside template HTML — is forbidden.

## Building

- **No `wp:html`.** If you're about to use it to achieve a goal, stop. Insert a placeholder paragraph block instead and open a GitHub issue per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md` describing what the human needs to wire up.
- **No fallback to plain HTML.** Block markup only — at every level. Plain HTML in a `templates/` or `parts/` file silently breaks the FSE editor.
- **Internal links resolve through `templateMappings`.** When emitting an `href` for a navigation item, CTA, or in-body link, look up the link label in `templateMappings` from `neptune-config.json` and wire to that entry's `pageUrl`. For labels that don't match any mapped entry, leave a placeholder `#` href and open a GitHub issue listing the unwired labels.
- **Header/footer parts wire nav from the same source.** When building `parts/header.html` or `parts/footer.html`, every menu item's `href` resolves the same way as above.
- **Stale `pageUrl` sanity check.** Before trusting a stored `pageUrl` from `templateMappings`, verify with `curl -sf -o /dev/null -w '%{http_code}' '<url>'`. On 4xx/5xx, treat the stored value as stale and re-resolve via WP CLI rather than emit a broken link.
- **Follow-ups are GitHub issues, not chat bullets.** Every human-actionable follow-up surfaced during a run becomes a `gh issue create` call per `${CLAUDE_PLUGIN_ROOT}/references/github-followups.md`. Inline lists of "things for the user to do" in a final summary are forbidden.

## Accessibility, performance, SEO

These are non-negotiable defaults during initial builds. Apply as you emit markup; do not defer to a "fix later" pass.

- **Landmarks.** Use semantic block defaults: `core/group` with the appropriate `tagName` for `<header>`, `<main>`, `<footer>`, `<nav>`, `<aside>`. Templates without a `<main>` landmark fail accessibility audits.
- **Heading hierarchy.** Exactly one `<h1>` per page. Don't skip levels. If the Figma design implies a wrong hierarchy, flag it as a dev-note conflict and open an issue rather than silently fixing it in markup.
- **Image alt text.** Every `core/image` needs `alt`. Pull it from Figma layer names or component descriptions where possible; for genuinely decorative images leave an empty alt; for images where alt is unknown, open an issue listing them.
- **Lazy-loading.** Below-the-fold images must use `loading="lazy"`. Above-the-fold hero imagery must use `loading="eager"` and ideally `fetchpriority="high"`.
- **Focus states.** Buttons and links rendered via block stylesheets must have visible `:focus-visible` styles defined in their corresponding SCSS file. Never rely on browser defaults.
- **Skip link.** Templates that include a header part must ensure the header part includes `<a class="skip-link" href="#main">` (or equivalent).

## Cross-file consistency

`mcp__wordpress-studio__validate_blocks` validates per-chunk markup but does not see across files. When a build or refine step writes a theme file (template, part, `theme.json`, `functions.php`, a block stylesheet), be deliberate about the cross-file properties below — `validate_blocks` will not catch them for you, and the contracts in `${CLAUDE_PLUGIN_ROOT}/references/theme-json-keys.md` and `${CLAUDE_PLUGIN_ROOT}/references/block-markup.md` are authoritative:

- `theme.json` schema (version, $schema, slug uniqueness across each preset array).
- Every `templateParts` entry has a matching `parts/<name>.html`.
- Every `customTemplates` entry has a matching `templates/<name>.html`.
- Every `<!-- wp:template-part {"slug":"X"} /-->` references a part that exists.
- Every preset reference (`var(--wp--preset--…)`, `"textColor":"…"`, `"fontSize":"…"`) resolves to a slug in `theme.json`.
- Required blocks per template slug (e.g. `single.html` contains `<!-- wp:post-content`).
