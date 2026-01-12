import chalk from "chalk";
import { execSsh, waitForSsh } from "./ssh.js";
import type { DropletInfo, ExecResult } from "./types.js";

/**
 * Status of a droplet during creation.
 */
export type DropletSetupStatus =
	| "creating"
	| "waiting_for_active"
	| "waiting_for_ssh"
	| "installing_nodejs"
	| "cloning_repo"
	| "installing_deps"
	| "building"
	| "ready"
	| "failed";

/**
 * Callback for progress updates during droplet setup.
 */
export type ProgressCallback = (
	droplet: DropletInfo,
	status: DropletSetupStatus,
	message?: string,
) => void;

/**
 * Generate the setup script for a droplet.
 * Downloads Node.js directly from nodejs.org and installs to /usr/local.
 */
export function generateSetupScript(branch: string): string {
	return `#!/bin/bash
set -e

export DEBIAN_FRONTEND=noninteractive
NODE_VERSION="20.19.0"

echo "=== Waiting for apt locks (up to 2 min) ==="
WAIT_COUNT=0
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
      fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || \
      fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
    echo "Waiting for apt locks... (\$WAIT_COUNT s)"
    sleep 5
    WAIT_COUNT=\$((WAIT_COUNT + 5))
    if [ \$WAIT_COUNT -ge 120 ]; then
        echo "Timed out waiting for apt locks, proceeding anyway..."
        break
    fi
done

echo "=== Downloading Node.js \$NODE_VERSION ==="
cd /tmp
curl -fsSL "https://nodejs.org/dist/v\$NODE_VERSION/node-v\$NODE_VERSION-linux-x64.tar.xz" -o node.tar.xz

echo "=== Installing Node.js to /usr/local ==="
tar -xJf node.tar.xz
cp -r node-v\$NODE_VERSION-linux-x64/{bin,lib,share} /usr/local/
rm -rf node.tar.xz node-v\$NODE_VERSION-linux-x64

echo "=== Verifying Node installation ==="
/usr/local/bin/node --version
/usr/local/bin/npm --version

echo "=== Installing Yarn ==="
/usr/local/bin/npm install -g yarn

echo "=== Cloning repository ==="
git clone --branch ${branch} https://github.com/MetaMask/mobile-wallet-protocol /app

echo "=== Installing dependencies ==="
cd /app
/usr/local/bin/yarn install

echo "=== Building ==="
/usr/local/bin/yarn build

echo "=== Setup complete ==="
`;
}

/**
 * Run the setup script on a droplet.
 * Reports progress via the callback.
 */
export async function setupDroplet(
	droplet: DropletInfo,
	branch: string,
	privateKeyPath: string,
	onProgress?: ProgressCallback,
): Promise<ExecResult> {
	if (!droplet.ip) {
		throw new Error(`Droplet ${droplet.name} has no IP address`);
	}

	// Wait for SSH to be available
	onProgress?.(droplet, "waiting_for_ssh");
	await waitForSsh(droplet.ip, privateKeyPath);

	// Run the setup script
	onProgress?.(droplet, "installing_nodejs");
	const script = generateSetupScript(branch);

	try {
		const result = await execSsh(
			droplet.ip,
			script,
			privateKeyPath,
			600000, // 10 minute timeout for full setup
		);

		if (result.exitCode === 0) {
			onProgress?.(droplet, "ready");
			return { ...result, dropletName: droplet.name };
		} else {
			// Get last few lines of stderr or stdout for context
			const errorContext = (result.stderr || result.stdout).trim().split("\n").slice(-5).join("\n");
			const errorMsg = `Exit code ${result.exitCode}: ${errorContext}`;
			onProgress?.(droplet, "failed", errorMsg);
			throw new Error(errorMsg);
		}
	} catch (error) {
		onProgress?.(droplet, "failed", (error as Error).message);
		throw error;
	}
}

/**
 * Format a status for display.
 */
export function formatStatus(status: DropletSetupStatus): string {
	switch (status) {
		case "creating":
			return chalk.dim("○ creating...");
		case "waiting_for_active":
			return chalk.dim("○ waiting for active...");
		case "waiting_for_ssh":
			return chalk.yellow("● waiting for SSH...");
		case "installing_nodejs":
			return chalk.yellow("● installing Node.js...");
		case "cloning_repo":
			return chalk.yellow("● cloning repo...");
		case "installing_deps":
			return chalk.yellow("● installing deps...");
		case "building":
			return chalk.yellow("● building...");
		case "ready":
			return chalk.green("✓ ready");
		case "failed":
			return chalk.red("✗ failed");
		default:
			return chalk.dim("○ unknown");
	}
}

