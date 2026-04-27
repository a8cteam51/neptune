---
name: dev-notes
description: Collate `💬 Dev Note` components from the linked Figma file into neptune-config.json for the neptune plugin. Use after setup-project, or re-run later to refresh stored notes after the Figma file changes.
---

This skill is safe to re-run; it overwrites the stored notes with the current state of the Figma file.

Goal: find every `💬 Dev Note` component in the Figma file, capture its text and placement context, and save each under a `devNotes` object in `neptune-config.json`. Later skills reference these notes when styling and building templates.

1. Read `neptune-config.json` for the Figma file ID. Load the `figma:figma-use` skill before making any Figma MCP calls that require JS execution in the file context.
2. Use the Figma MCP to find every instance of the `💬 Dev Note` component in the file.
3. For each instance, capture:
   - The text content of the note.
   - The placement context — the parent component or layout the note sits inside (e.g. `Header`, `Blog Post`), plus any elements the note overlaps or points at (e.g. "overlapping the hero CTA button").
4. Write the notes to `neptune-config.json` under a `devNotes` object. Each key is a stable, context-derived identifier (e.g. `header-logo-spacing`, `blog-post-byline`). Each value is `{ "text": "...", "context": "..." }`.
