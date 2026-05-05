#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 5 ]; then
	echo "Usage: $0 <project_name> <figma_file_id> <repository_url> <theme_slug> <figma_dev_handoff_node_id>"
	echo "  figma_dev_handoff_node_id is the X:Y node id of the dev-handoff page,"
	echo "  extracted from a Figma 'Copy link to selection' URL (the node-id query"
	echo "  param, with '-' converted to ':')."
	exit 1
fi

project_name="$1"
figma_file_id="$2"
repository_url="$3"
theme_slug="$4"
figma_dev_handoff_node_id="$5"

# Validate node id shape: must look like "<digits>:<digits>".
if [[ ! "$figma_dev_handoff_node_id" =~ ^[0-9]+:[0-9]+$ ]]; then
	echo "Error: figma_dev_handoff_node_id \"$figma_dev_handoff_node_id\" is not a valid Figma node id."
	echo "  Expected the form \"X:Y\" where X and Y are integers."
	echo "  In Figma, right-click the dev-handoff page tab, choose"
	echo "  'Copy link to selection', and convert the URL's node-id from"
	echo "  'X-Y' to 'X:Y'."
	exit 1
fi
config_file="neptune-config.json"
wordpress_dir="wordpress"
wordpress_url="https://wordpress.org/latest.zip"
temp_dir="$(mktemp -d)"

# Track which artifacts this run created so we can roll them back on
# error. Without this, a partial failure (e.g. mid-clone, mid-extract)
# leaves the directory in a state the idempotency guards at the top of
# the next run will reject — with no recovery path short of manual rm.
created_wordpress_dir=0
created_config_file=0

cleanup() {
	rc=$?
	rm -rf "$temp_dir"
	if [ "$rc" -ne 0 ]; then
		# Roll back only artifacts this run created. Never touch a
		# pre-existing wordpress/ or neptune-config.json — the
		# idempotency guards below ensure we only ever flip these
		# flags on after creating the artifact ourselves.
		if [ "$created_wordpress_dir" = "1" ] && [ -d "$wordpress_dir" ]; then
			rm -rf "$wordpress_dir"
			echo "Rolled back partial $wordpress_dir/ on failure." >&2
		fi
		if [ "$created_config_file" = "1" ] && [ -f "$config_file" ]; then
			rm -f "$config_file"
			echo "Rolled back partial $config_file on failure." >&2
		fi
	fi
}

trap cleanup EXIT

# Validate theme slug shape — must match a typical WordPress theme directory
# name: lowercase letters, digits, hyphens; non-empty; no leading/trailing hyphen.
if [[ ! "$theme_slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
	echo "Error: theme_slug \"$theme_slug\" is not a valid WordPress theme slug."
	echo "  Expected lowercase letters, digits, and hyphens only."
	echo "  Derived from: $repository_url"
	echo "  Strip any '.git' suffix and 'tree/branch' fragments before deriving."
	exit 1
fi

# Idempotency guard: refuse to clobber an existing project.
if [ -e "$config_file" ]; then
	echo "Error: $config_file already exists in $(pwd)."
	echo "  This script is destructive on re-run. Move or delete the file first,"
	echo "  or run from a clean project directory."
	exit 1
fi
if [ -e "$wordpress_dir" ]; then
	echo "Error: $wordpress_dir/ already exists in $(pwd)."
	echo "  This script is destructive on re-run. Move or delete the directory"
	echo "  first, or run from a clean project directory."
	exit 1
fi

mkdir -p "$wordpress_dir"
created_wordpress_dir=1

curl -fsSL "$wordpress_url" -o "$temp_dir/latest.zip"
unzip -q "$temp_dir/latest.zip" -d "$temp_dir"
cp -R "$temp_dir/wordpress/." "$wordpress_dir/"
rm -rf "$wordpress_dir/wp-content"
git clone "$repository_url" "$wordpress_dir/wp-content"

for required_dir in plugins uploads; do
	path="$wordpress_dir/wp-content/$required_dir"
	if [ -e "$path" ] && [ ! -d "$path" ]; then
		echo "Error: $path exists but is not a directory"
		exit 1
	fi
	mkdir -p "$path"
done

if [ -f "$wordpress_dir/wp-content/package.json" ]; then
	(cd "$wordpress_dir/wp-content" && npm install)
else
	echo "Skipping npm install — no package.json found in $wordpress_dir/wp-content"
fi

theme_dir="$wordpress_dir/wp-content/themes/$theme_slug"
style_file="$theme_dir/style.css"

if [ ! -d "$theme_dir" ]; then
	echo "Error: theme directory not found at $theme_dir"
	echo "  The cloned repository's themes/ folder does not contain a directory"
	echo "  matching the derived theme slug \"$theme_slug\"."
	echo "  Check that the repository URL points at the right repo, and that"
	echo "  the theme directory inside wp-content/themes/ matches the slug"
	echo "  derived from the repo URL."
	exit 1
fi

# Only write the placeholder theme.json if one does not already exist —
# otherwise we'd silently clobber theme-managed config from the cloned repo.
if [ ! -f "$theme_dir/theme.json" ]; then
	cat > "$theme_dir/theme.json" <<EOF
{
	"\$schema": "https://schemas.wp.org/trunk/theme.json",
	"version": 3
}
EOF
	wrote_theme_json=1
else
	echo "Skipping theme.json — already present at $theme_dir/theme.json"
	wrote_theme_json=0
fi

if [ ! -f "$style_file" ]; then
	echo "Error: style file not found at $style_file"
	exit 1
fi

# Strip the "Theme URI" header from the team51 scaffold's style.css — the
# theme has no URI for a freshly-cloned project. Match the header explicitly
# rather than trusting line position, so scaffold drift does not silently
# delete the wrong header.
stripped_style=0
if grep -qE '^[[:space:]]*Theme URI[[:space:]]*:' "$style_file"; then
	awk '!/^[[:space:]]*Theme URI[[:space:]]*:/' "$style_file" > "$temp_dir/style.css"
	mv "$temp_dir/style.css" "$style_file"
	stripped_style=1
else
	echo "Skipping Theme URI strip — no Theme URI header found in $style_file"
fi

mkdir -p "$theme_dir/templates"
# Only create an empty index.html if there isn't already one (cloned repos
# may ship a starter template that we should not silently truncate).
if [ ! -f "$theme_dir/templates/index.html" ]; then
	: > "$theme_dir/templates/index.html"
	wrote_index=1
else
	echo "Skipping index.html — already present at $theme_dir/templates/index.html"
	wrote_index=0
fi

cat > "$config_file" <<EOF
{
	"projectName": "$project_name",
	"figmaFileId": "$figma_file_id",
	"figmaDevHandoffNodeId": "$figma_dev_handoff_node_id",
	"repositoryUrl": "$repository_url",
	"themeSlug": "$theme_slug"
}
EOF
created_config_file=1

echo "Created $config_file in $(pwd)"
echo "Created $wordpress_dir directory in $(pwd)"
echo "Downloaded and extracted WordPress into $wordpress_dir"
echo "Prepared an empty $wordpress_dir/wp-content directory"
echo "Cloned $repository_url into $wordpress_dir/wp-content"
echo "Ensured $wordpress_dir/wp-content/plugins and $wordpress_dir/wp-content/uploads exist"
echo "Ran npm install in $wordpress_dir/wp-content"
if [ "$wrote_theme_json" = "1" ]; then
	echo "Created placeholder $theme_dir/theme.json"
fi
if [ "$stripped_style" = "1" ]; then
	echo "Stripped Theme URI header from $style_file"
fi
if [ "$wrote_index" = "1" ]; then
	echo "Created empty $theme_dir/templates/index.html"
fi
