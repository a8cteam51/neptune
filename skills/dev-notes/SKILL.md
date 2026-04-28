---
name: dev-notes
description: Collates every `💬 Dev Note` component from the linked Figma file's Dev Handoff page into neptune-config.json under `devNotes`. Safe to re-run; overwrites stored notes. Used after setup-project, or any time the Figma file's dev notes have changed. Triggers on phrases like "pull dev notes from Figma", "refresh the dev notes", "sync Figma annotations", or "capture designer notes".
---

This skill is safe to re-run; it overwrites the stored notes with the current state of the Figma file.

Goal: find every `💬 Dev Note` component in the Figma file from the `🛠️  Dev Handoff` page, capture its text and placement context, and save each under a `devNotes` object in `neptune-config.json`. Later skills reference these notes when styling and building templates.

1. Read `neptune-config.json` for the Figma file ID. Load the `figma:figma-use` skill before making any Figma MCP calls that require JS execution in the file context.
2. Use the Figma MCP to find every instance of the `💬 Dev Note` component in the `🛠️  Dev Handoff` page. The name may also include a date, if multiple dev handoff pages exist, use the one with the closest to today's date.
3. For each instance, capture:
   - The text content of the note.
   - The placement context — the parent component or layout the note sits inside (e.g. `Header`, `Blog Post`), plus any elements the note overlaps or points at (e.g. "overlapping the hero CTA button").
4. Write the notes to `neptune-config.json` under a `devNotes` object. Each key is a stable, context-derived identifier (e.g. `header-logo-spacing`, `blog-post-byline`). Each value is `{ "text": "...", "context": "..." }`.
5. Set `devNotesCompleted: true` in `neptune-config.json` (alongside the `devNotes` object). The boolean is the completion signal; the data lives under `devNotes`.

6. Tell the user how many dev notes were captured, then continue to the `map-design-templates` skill if `neptune-config.json` does not already have `templateMappingsCompleted: true`. If it does, ask the user whether to re-run `map-design-templates` now or skip it.
