#!/bin/zsh
# Temporarily replaces all workspace:* dependencies with concrete ^<version> in package.json files.

set -euo pipefail

# Packages to process
PACKAGES_TO_PROCESS=("packages/dapp-client" "packages/wallet-client" "apps/rn-demo" "apps/web-demo")

# Publishable packages that can be dependencies
PUBLISHABLE_PACKAGES=("packages/core" "packages/dapp-client" "packages/wallet-client")

# Use an associative array to store package versions (zsh syntax)
typeset -A PkgVersions

echo "Reading versions of publishable packages..."
for PKG_DIR in "${PUBLISHABLE_PACKAGES[@]}"; do
    MANIFEST="$PKG_DIR/package.json"
    if [ -f "$MANIFEST" ]; then
        PKG_NAME=$(jq -r '.name' "$MANIFEST")
        PKG_VERSION=$(jq -r '.version' "$MANIFEST")
        PkgVersions[$PKG_NAME]="^$PKG_VERSION"
        echo "- $PKG_NAME @ ${PkgVersions[$PKG_NAME]}"
    fi
done

echo "Processing packages for workspace dependencies..."
for PKG_DIR in "${PACKAGES_TO_PROCESS[@]}"; do
    MANIFEST="$PKG_DIR/package.json"
    if [ ! -f "$MANIFEST" ]; then continue; fi

    echo "-> Processing $MANIFEST"

    # Backup if not already
    if [ ! -f "$MANIFEST.bak" ]; then
        cp "$MANIFEST" "$MANIFEST.bak"
    fi

    # Create a temporary manifest to apply changes to
    cp "$MANIFEST" temp.json

    # Use a while read loop for robustness
    jq -r '.dependencies | to_entries[] | select(.value == "workspace:*") | .key' "$MANIFEST" | while read -r DEP_NAME; do
        # Skip empty lines
        if [ -z "$DEP_NAME" ]; then continue; fi

        # zsh syntax for checking if key exists
        if (( ${+PkgVersions[$DEP_NAME]} )); then
            DEP_VERSION=${PkgVersions[$DEP_NAME]}
            echo "  - In $MANIFEST, replacing '$DEP_NAME' with '$DEP_VERSION'"
            # Update the temp manifest
            jq --tab --arg dep "$DEP_NAME" --arg ver "$DEP_VERSION" '
                .dependencies[$dep] = $ver
            ' temp.json > temp2.json && mv temp2.json temp.json
        else
            echo "  - Warning: Could not find version for workspace dependency '$DEP_NAME' in $MANIFEST. Skipping."
        fi
    done

    # Move the final updated manifest into place
    mv temp.json "$MANIFEST"
done

echo "Running yarn install to update lockfile..."
yarn install

echo "Preparation complete. Run 'yarn create-release-branch' now."
