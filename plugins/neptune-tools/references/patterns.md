# Patterns (filesystem patterns)

Use this file when adding patterns that should be available in the inserter.

## Filesystem patterns

- Patterns live at `<theme>/patterns/<kebab-slug>.php`. Neptune writes the PHP wrapper itself; agents only return block markup plus header metadata via the `tsx-to-pattern` skill envelope.
- WordPress core auto-registers each PHP file based on its header comment block (`Title:`, `Slug:`, `Categories:`, `Block Types:`, `Viewport Width:`, `Inserter:`, `Description:`, `Keywords:`).
- Slug values that Neptune emits are theme-prefixed (e.g. `Slug: <theme-slug>/<kebab>`) so they don't collide with patterns shipped by other themes or core.

Upstream reference:

- https://developer.wordpress.org/themes/patterns/

## Practical guardrails

- Keep pattern markup stable; changing block names inside patterns can break older content in subtle ways.
- If a pattern should not be inserted directly by users, mark it as non-inserter / internal-only (per upstream header conventions).
- Templates and content that include a registered pattern should reference it via `<!-- wp:pattern {"slug":"<theme>/<kebab>"} /-->` rather than inlining its body. The `tsx-to-blocks` skill receives the registered-patterns inventory and emits these references automatically when a JSX call's PascalCase name matches.

