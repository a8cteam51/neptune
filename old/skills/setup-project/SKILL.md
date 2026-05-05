---
name: setup-project
description: Scaffolds a new Team 51 WordPress block-theme project — downloads WordPress core, clones the theme repo into wp-content, creates a Studio site, and writes neptune-config.json. Used after `check-environment` has confirmed the environment, and after the user has created the Pressable site and GitHub repo via the Team51 CLI. 
---

Prerequisites the user must complete before this skill runs:
- In a separate terminal, run `team51 pressable:create-site`.
- In the Team51 flow, create a GitHub repo using the no-code project template. Leave the theme name empty.

If the user has not done this, stop and ask them to complete it before proceeding.

Steps:

1. Run `pwd` and show the absolute path to the user. Ask them to confirm this is the intended project root — the directory where `wordpress/` and `neptune-config.json` should live after setup. If they say no, ask them to `cd` into the right directory and then re-invoke the skill (you cannot change the agent's working directory between turns reliably, so a fresh invocation is the cleanest reset). Note: `neptune-config.json` does not exist yet; it will be created in step 3.

2. Gather from the user:
   - Project name
   - GitHub repository URL
   - **Figma Dev Handoff page URL.** Ask the user to open the Figma file (desktop or web), right-click the **dev-handoff page tab** (the page that contains the `🗒️ Templates` and `🎨 Style Guide` sections), and choose **"Copy link to selection."** Paste the URL. It must contain a `node-id` query param — if it doesn't, ask the user to repeat the right-click on the page tab itself rather than the canvas.

   Derive the theme slug from the repository URL (e.g. `https://github.com/user/my-theme.git` → `my-theme`). Do not ask the user for the theme slug.

   Extract the Figma file ID and the dev-handoff node ID from the URL with a one-liner. The URL format is `https://www.figma.com/design/<fileKey>/<name>?node-id=<X>-<Y>...`; the node id in the URL uses `-` and must be converted to `:` for the MCP. Example:
   ```bash
   FIGMA_URL="<url-from-user>"
   FIGMA_FILE_ID=$(echo "$FIGMA_URL" | sed -E 's|.*figma.com/design/([^/?]+).*|\1|')
   FIGMA_NODE_ID=$(echo "$FIGMA_URL" | sed -E 's|.*[?&]node-id=([0-9]+)-([0-9]+).*|\1:\2|')
   ```
   Validate both are non-empty before continuing.

3. Run `${CLAUDE_PLUGIN_ROOT}/scripts/init-project.sh "<project_name>" "<figma_file_id>" "<repository_url>" "<theme_slug>" "<figma_dev_handoff_node_id>"`. The script takes five positional arguments in that order and does not prompt. It will:
   - Create `wordpress/` with WordPress core files.
   - Clone the theme repo into `wordpress/wp-content`.
   - Run `npm install` in `wp-content` if a `package.json` exists there.
   - Write `neptune-config.json` at the project root with `projectName`, `figmaFileId`, `figmaDevHandoffNodeId`, `repositoryUrl`, `themeSlug`.

4. Create the WordPress site with Studio, from the `wordpress/` directory:
   - `studio site create --name="<project_name>"` — use the project name stored in `neptune-config.json`.
   - `studio site status` — confirm the site is running.
   - `studio wp theme activate <theme_slug>` — activate the project theme.
   - `studio wp plugin install create-block-theme --activate` — install and activate Create Block Theme (useful later for exporting edits from the block editor).
   - `studio wp plugin install safe-svg --activate` — install and activate Safe SVG (enables SVG uploads in the media library).

5. Ask the user which of the following site IA shapes the design uses, then run only the matching commands. Do not assume — the design may have neither, one, or both. If unclear, ask the user to point at the relevant Figma title cards before continuing.
   - **Static homepage** (the design has a dedicated homepage that is not a chronological post listing):
     - `studio wp post create --post_type=page --post_title=Home --post_status=publish --porcelain` — capture the returned page ID as `<home_id>`.
     - `studio wp option update show_on_front page`
     - `studio wp option update page_on_front <home_id>`
   - **Blog landing page** (the design has a dedicated `/blog` page that lists posts, distinct from the homepage):
     - `studio wp post create --post_type=page --post_title=Blog --post_status=publish --porcelain` — capture the returned page ID as `<blog_id>`.
     - `studio wp option update page_for_posts <blog_id>`
   If the user picks neither, leave WordPress on its default `show_on_front=posts` setting and move on.

6. Update `neptune-config.json` with `setupProjectCompleted: true` so future runs know the scaffold has been completed.

7. Load and follow the `pull-figma` skill to continue.
