#!/usr/bin/env bash

set -euo pipefail

if ! command -v studio &> /dev/null; then
	echo "WordPress Studio CLI is not installed."
	echo "Install from https://developer.wordpress.com/studio/"
	exit 1
fi

studio --version
