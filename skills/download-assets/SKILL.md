---
name: download-assets
description: Walk every desktop Figma node from `templateMappings`, export image assets to `/assets/` at the project root, import them into WordPress via `wp media import`, and record the Figma-image-to-WP-attachment map in `neptune-config.json` so later build and refine steps can wire `<!-- wp:image -->` blocks to real attachments instead of placeholders. Use after `map-design-templates`, before `theme-json`.
---

This skill is run once per project after `map-design-templates` has populated `templateMappings`. It scans only the **desktop** layout frames (per the user's instruction — desktop Figma frames carry every image asset; mobile typically reuses the same hashes), exports each unique image as a flattened raster, saves it to `assets/` at the project root, imports it into the WordPress media library, and records the mapping in `neptune-config.json` under `figmaAssets`.

Assets are defined as **any image rendered inside a page mockup** — concretely, any Figma node with an `IMAGE`-type fill, plus any node whose visual content is itself a raster (e.g. a placed PNG / JPG). Vector shapes styled with solid or gradient fills are **not** assets — those are CSS / `theme.json` styling concerns, not media-library content.

JPEG is preferred over PNG for compression. Fall back to PNG only when the source image has transparency (an alpha channel) — check the bytes returned by `figma.getImageByHash(hash).getBytesAsync()` rather than guessing from the node name. SVG / vector icons are out of scope for this skill (see step 7); flag them for the user.

Reference: WP CLI `media import` — https://developer.wordpress.org/cli/commands/media/import/

Context to load before starting:
- `neptune-config.json` at the project root — `figmaFileId`, `themeSlug`, `templateMappings`.
- The Figma MCP — confirm reachable. **Load the `figma:figma-use` skill first** — every step that walks the Figma node tree or calls `exportAsync` runs through `use_figma`.
- `studio wp` — must be running so media imports land in the active site. Confirm with `studio site status`.

Steps:

1. Read `figmaFileId`, `themeSlug`, and `templateMappings` from `neptune-config.json`. Stop and report if `templateMappings` is empty or missing — the user needs to run `/map-design-templates` first. Build the list of desktop node IDs to scan: every entry's `figmaNodes.desktop`. Skip entries that have no `desktop` node (note them for the final summary).

2. If `figmaAssets` already exists in `neptune-config.json`, ask the user whether to (a) skip already-recorded images and only export anything new, (b) re-export everything from scratch (will produce duplicate WP attachments unless the user manually clears the media library first), or (c) abort. Default to (a). This prevents accidental duplicate uploads on re-runs.

3. Use `use_figma` to walk the descendants of each desktop node and collect image-bearing nodes. For each candidate node, capture:
   - `nodeId`
   - `nodeName` (used for alt text — sanitize whitespace, drop emoji prefixes)
   - `imageHash` — pulled from the first `IMAGE`-type fill (`node.fills.find(f => f.type === 'IMAGE').imageHash`). Figma's image hash is content-addressable, so the same logo placed in header and footer shares one hash across multiple node IDs.
   - `sourceTemplate` — the `templateMappings` entry key the desktop node belongs to.
   - `hasAlpha` — read the source bytes via `figma.getImageByHash(imageHash).getBytesAsync()` and inspect the file signature (PNG `IHDR` color type 4 or 6, or any pixel with `alpha < 255`) to decide between JPEG and PNG output.

   Skip nodes whose only fills are `SOLID` or `GRADIENT_*` — those are styling, not assets.

4. Dedupe by `imageHash`. For each unique hash, keep one canonical `nodeId` to export from (any node sharing the hash will export identical bytes; pick the first encountered). Record the full list of `figmaNodeIds` and `sourceTemplates` that share the hash so the build/refine commands can match either.

5. For each unique image, use `use_figma` to export the canonical node:
   - JPEG branch (default, when `hasAlpha === false`): `node.exportAsync({ format: 'JPG', constraint: { type: 'SCALE', value: 2 } })` for retina quality.
   - PNG branch (when `hasAlpha === true`): `node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })`.

   Return the bytes as base64 to the main agent. Generate the filename as `<sanitized-node-name>-<imageHash-prefix>.<jpg|png>` — including a short hash prefix (first 8 chars of `imageHash`) keeps filenames stable across runs and avoids collisions when two nodes share a name. Keep filenames lowercase, kebab-case, ASCII-only.

6. Write each base64 payload to `assets/<filename>` at the project root. Create the `assets/` directory if it does not exist. Add `assets/` to the project's `.gitignore` if not already present — these files are an intermediate artefact; the source of truth is Figma + the WP media library.

7. Identify any vector / SVG-only assets that turned up in the scan — Figma exposes them via `node.exportAsync({ format: 'SVG' })`, and they should **not** go through `wp media import` as raster files. List them at the end for the user with their node IDs and Figma URLs, and ask whether to (a) export to `assets/svg/` and leave them as theme assets (not media-library imports), (b) flatten to PNG and import via the normal flow, or (c) skip. Do not auto-decide.

8. For each raster file written in step 6, import into WordPress via WP CLI. Use `--porcelain` to capture just the attachment ID:
   ```bash
   studio wp media import "assets/<filename>" --alt="<sanitized nodeName>" --title="<sanitized nodeName>" --porcelain
   ```
   Capture the attachment ID per import. If `studio wp media import` fails for a file, record the reason and continue with the rest — open a GitHub issue for any failed import so the user can investigate.

9. Resolve each attachment's URL so the build/refine commands can reference it directly:
   ```bash
   studio wp eval "echo wp_get_attachment_url( <attachment-id> );"
   ```

10. Update `neptune-config.json` with a `figmaAssets` object keyed by `imageHash`. Each value:
    ```json
    {
      "filename": "<sanitized>.jpg",
      "localPath": "assets/<sanitized>.jpg",
      "altText": "<sanitized nodeName>",
      "wpAttachmentId": <int>,
      "wpUrl": "<full attachment URL>",
      "figmaNodeIds": ["<id1>", "<id2>", "..."],
      "sourceTemplates": ["<entry-key>", "..."]
    }
    ```
    Keying by `imageHash` (not node ID) is deliberate: build/refine commands can look up the right attachment whether they see the image referenced by hash, by any of its node IDs, or by filename. Preserve any existing entries the user opted to keep in step 2.

11. If you have any follow-ups for the user — failed imports, ambiguous SVG handling, alt text that needs human review (e.g. nodeName was a generic `Image 12` rather than something descriptive) — open a GitHub issue for each in the project repo (use `repositoryUrl` and `themeSlug` from `neptune-config.json` to construct the `gh issue create` command). Link to the relevant Figma node URL so the human can see the source. Note in the body that the issue was created by Neptune.

12. Tell the user how many unique images were exported, how many were imported into WP (with attachment IDs), how many were skipped (with reasons), and that the next skill in the flow is `theme-json`.
