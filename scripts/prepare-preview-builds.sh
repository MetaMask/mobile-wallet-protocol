#!/usr/bin/env bash

set -euo pipefail

# This script prepares a package to be published as a preview build
# to GitHub Packages.

if [[ $# -eq 0 ]]; then
  echo "Missing commit hash."
  exit 1
fi

# We don't want to assume that preview builds will be published alongside
# "production" versions. There are security- and aesthetic-based advantages to
# keeping them separate.
npm_scope="$1"

# We use the short commit hash as the prerelease version. This ensures each
# preview build is unique and can be linked to a specific commit.
shorthash="$2"

echo "Preparing manifests..."

# Get a list of all package.json files for our workspaces.
# The `read -r` and `mapfile` commands are a safe way to handle file paths.
read -r -d '' -a package_json_files < <(yarn workspaces list --no-private --json | jq --compact-output --raw-output 'select(.location != ".") | .location + "/package.json"' && printf '\0')

# Pass all package.json files to jq to rename them and update their versions.
# This is more efficient than calling jq once per file.
for file in "${package_json_files[@]}"; do
  jq \
    --arg npm_scope "$npm_scope" \
    --arg hash "$shorthash" \
    --from-file scripts/prepare-preview-builds.jq \
    "$file" > tmp.json && mv tmp.json "$file"
done

echo "Updating internal dependencies to preview scope..."
node scripts/update-preview-deps.js "$npm_scope" "${package_json_files[@]}"

echo "Installing dependencies with updated names..."
# The --no-immutable flag is critical because we have modified package.json files.
yarn install --no-immutable