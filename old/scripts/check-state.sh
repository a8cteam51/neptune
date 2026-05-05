#!/usr/bin/env bash

# check-state.sh — verify neptune-config.json contains the keys a skill or
# command needs before it runs. Call as the first step of every skill /
# command instead of re-implementing the same prologue inline.
#
# Usage:
#   check-state.sh <key1> [key2 ...]
#
# A "key" is either:
#   - a top-level boolean key that must be present and true (e.g.
#     `setupProjectCompleted`, `templateMappingsCompleted`)
#   - a top-level non-boolean key that must be present and non-empty (e.g.
#     `templateMappings`, `devNotes`)
#
# On success: prints nothing, exits 0.
# On failure: prints a one-line diagnostic per missing key naming the skill
# the user should run to populate it, then exits 1.

set -euo pipefail

config_file="neptune-config.json"

if [ ! -f "$config_file" ]; then
	echo "Error: $config_file not found in $(pwd)."
	echo "  Run the setup-project skill from the intended project root first."
	exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
	echo "Error: jq is required by check-state.sh but was not found on PATH."
	echo "  Install jq (https://jqlang.org/) and re-run."
	exit 1
fi

# Map each key to the skill or command that populates it. Keep this aligned
# with the workflow table in the README.
hint_for() {
	case "$1" in
		setupProjectCompleted)        echo "setup-project skill" ;;
		figmaPullCompleted|devNotes|figmaVariables|figmaStyleGuideNodeId)
		                              echo "pull-figma skill" ;;
		templateMappingsCompleted|templateMappings)
		                              echo "map-design-templates skill (after pull-figma populates candidates)" ;;
		themeJsonCompleted)           echo "theme-json skill" ;;
		patternsCompleted|patterns)   echo "extract-patterns skill" ;;
		projectName|figmaFileId|figmaDevHandoffNodeId|repositoryUrl|themeSlug)
		                              echo "setup-project skill (init-project.sh)" ;;
		*)                            echo "the skill that populates \"$1\"" ;;
	esac
}

missing=0

for key in "$@"; do
	# Decide whether this key is a boolean completion flag or a data key.
	# Completion flags end in "Completed"; everything else is treated as
	# "must exist and be non-empty/non-null".
	case "$key" in
		*Completed)
			if ! jq -e --arg k "$key" '.[$k] == true' "$config_file" >/dev/null; then
				echo "Missing: \"$key\" is not true in $config_file. Run $(hint_for "$key") first."
				missing=1
			fi
			;;
		*)
			# `has + non-null + non-empty` covers strings, arrays, and objects.
			if ! jq -e --arg k "$key" '
				has($k)
				and (.[$k] != null)
				and ((.[$k] | type) as $t |
					if $t == "string" then (.[$k] | length) > 0
					elif $t == "array"  then (.[$k] | length) > 0
					elif $t == "object" then (.[$k] | length) > 0
					else true
					end)
			' "$config_file" >/dev/null; then
				echo "Missing: \"$key\" is empty or absent in $config_file. Run $(hint_for "$key") first."
				missing=1
			fi
			;;
	esac
done

exit "$missing"
