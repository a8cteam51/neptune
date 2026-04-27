#!/usr/bin/env bash

set -euo pipefail

if ! command -v team51 &> /dev/null; then
    echo "Team51 CLI is not installed. Please install it from our GitHub repository."
    exit 1
fi

echo "Team51 CLI is installed."
