---
name: setup-project
description: Scaffold a new Team 51 WordPress project — download WordPress, clone the theme repo into wp-content, create a Studio site, and write neptune-config.json. Use after `neptune` has confirmed the environment, and after the user has created the Pressable site and GitHub repo via the Team51 CLI.
---

Prerequisites the user must complete before this skill runs:
- In a separate terminal, run `team51 pressable:create-site`.
- In the Team51 flow, create a GitHub repo using the no-code project template. Leave the theme name empty.

If the user has not done this, stop and ask them to complete it before proceeding.

Steps:

1. Confirm the user's current working directory is the project root — the directory where `wordpress/` and `neptune-config.json` should live after setup. If they are not in the intended project directory, ask them to `cd` into it before continuing. Note: `neptune-config.json` does not exist yet; it will be created in step 3.

2. Gather from the user:
   - Project name
   - Figma file ID
   - GitHub repository URL

   Derive the theme slug from the repository URL (e.g. `https://github.com/user/my-theme.git` → `my-theme`). Do not ask the user for the theme slug.

3. Run `${CLAUDE_PLUGIN_ROOT}/scripts/init-project.sh "<project_name>" "<figma_file_id>" "<repository_url>" "<theme_slug>"`. The script takes four positional arguments in that order and does not prompt. It will:
   - Create `wordpress/` with WordPress core files.
   - Clone the theme repo into `wordpress/wp-content`.
   - Run `npm install` in `wp-content` if a `package.json` exists there.
   - Write `neptune-config.json` at the project root with `projectName`, `figmaFileId`, `repositoryUrl`, `themeSlug`.

4. Create the WordPress site with Studio, from the `wordpress/` directory:
   - `studio site create --name="<project_name>"` — use the project name stored in `neptune-config.json`.
   - `studio site status` — confirm the site is running.
   - `studio wp theme activate <theme_slug>` — activate the project theme.
   - `studio wp plugin install create-block-theme --activate` — install and activate Create Block Theme (useful later for exporting edits from the block editor).

5. Tell the user setup is complete, and that the next skills in the flow are `dev-notes`, then `theme-json`, then `map-design-templates`. Do not auto-invoke the next skill — the user runs each one manually.

6. Remind the user that the Figma file is the source of truth for the rest of the workflow. All subsequent skills and commands read designs directly from Figma via the Figma MCP — no manual exports are required. Confirm the Figma MCP is reachable before moving on; if it is not, point the user at https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/#claude-code.
