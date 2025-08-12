#!/bin/zsh
# Restores original package.json from backups.

set -euo pipefail

PACKAGES=("packages/dapp-client" "packages/wallet-client" "apps/rn-demo" "apps/web-demo")

RESTORED=0
for PKG in "${PACKAGES[@]}"; do
  MANIFEST="$PKG/package.json"
  BACKUP="$MANIFEST.bak"

  if [ -f "$BACKUP" ]; then
    mv "$BACKUP" "$MANIFEST"
    echo "Restored $MANIFEST from backup."
    RESTORED=1
  else
    echo "Warning: No backup found for $MANIFEST. Skipping."
  fi
done

if (( RESTORED == 0 )); then
  echo "Nothing to revert."
  exit 0
fi

# Restore lockfile
yarn install

echo "Revert complete. Workspace restored."
