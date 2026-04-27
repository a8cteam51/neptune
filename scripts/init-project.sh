#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 4 ]; then
	echo "Usage: $0 <project_name> <figma_file_id> <repository_url> <theme_slug>"
	exit 1
fi

project_name="$1"
figma_file_id="$2"
repository_url="$3"
theme_slug="$4"
config_file="neptune-config.json"
wordpress_dir="wordpress"
wordpress_url="https://wordpress.org/latest.zip"
temp_dir="$(mktemp -d)"

cleanup() {
	rm -rf "$temp_dir"
}

trap cleanup EXIT

mkdir -p "$wordpress_dir"

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
	exit 1
fi

cat > "$theme_dir/theme.json" <<EOF
{
	"\$schema": "https://schemas.wp.org/trunk/theme.json",
	"version": 3
}
EOF

if [ ! -f "$style_file" ]; then
	echo "Error: style file not found at $style_file"
	exit 1
fi

# Strip the "Theme URI" header from the team51 scaffold's style.css — the
# theme has no URI for a freshly-cloned project. Guard against scaffold drift:
# fail loudly if line 3 is not a header line rather than silently corrupting
# the file.
line3="$(sed -n '3p' "$style_file")"
if [[ ! "$line3" =~ ^[A-Z][A-Za-z\ ]*:.* ]]; then
	echo "Error: $style_file line 3 does not look like a theme header line."
	echo "  Expected a 'Header Name: value' line."
	echo "  Got: $line3"
	echo "The team51 scaffold may have changed. Update init-project.sh."
	exit 1
fi
awk 'NR != 3' "$style_file" > "$temp_dir/style.css"
mv "$temp_dir/style.css" "$style_file"

mkdir -p "$theme_dir/templates"
: > "$theme_dir/templates/index.html"

mkdir -p "screenshots"

cat > "$config_file" <<EOF
{
	"projectName": "$project_name",
	"figmaFileId": "$figma_file_id",
	"repositoryUrl": "$repository_url",
	"themeSlug": "$theme_slug"
}
EOF

echo "Created $config_file in $(pwd)"
echo "Created $wordpress_dir directory in $(pwd)"
echo "Downloaded and extracted WordPress into $wordpress_dir"
echo "Prepared an empty $wordpress_dir/wp-content directory"
echo "Cloned $repository_url into $wordpress_dir/wp-content"
echo "Ensured $wordpress_dir/wp-content/plugins and $wordpress_dir/wp-content/uploads exist"
echo "Ran npm install in $wordpress_dir/wp-content"
echo "Created placeholder $theme_dir/theme.json"
echo "Stripped Theme URI header from $style_file"
echo "Created empty $theme_dir/templates/index.html"
echo "Created empty screenshots/ directory at the project root"
