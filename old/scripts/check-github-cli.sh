#!/usr/bin/env bash

set -euo pipefail

if ! command -v gh &> /dev/null; then
	echo "GitHub CLI (gh) is not installed."
	echo "Install with: brew install gh"
	echo "Or see https://cli.github.com/ for other platforms."
	exit 1
fi

if ! gh auth status &> /dev/null; then
	echo "GitHub CLI is installed but not authenticated. Run: gh auth login"
	exit 1
fi

echo "GitHub CLI is installed and authenticated."
