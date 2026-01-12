import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config as loadDotenv } from "dotenv";
import type { InfraConfig, SshConfig } from "./types.js";

// Load .env file from the load-tests directory
const envPath = path.resolve(import.meta.dirname, "../../.env");
loadDotenv({ path: envPath });

/**
 * Load and validate infrastructure configuration from environment variables.
 * Throws an error if required variables are missing.
 */
export function loadInfraConfig(): InfraConfig {
	const digitalOceanToken = process.env.DIGITALOCEAN_TOKEN;
	const sshKeyFingerprint = process.env.SSH_KEY_FINGERPRINT;
	const sshPrivateKeyPath = process.env.SSH_PRIVATE_KEY_PATH ?? "~/.ssh/id_rsa";

	if (!digitalOceanToken) {
		throw new Error(
			"DIGITALOCEAN_TOKEN is required.\n" +
			"Set it in apps/load-tests/.env or as an environment variable.\n" +
			"Get a token from: https://cloud.digitalocean.com/account/api/tokens"
		);
	}

	if (!sshKeyFingerprint) {
		throw new Error(
			"SSH_KEY_FINGERPRINT is required.\n" +
			"Set it in apps/load-tests/.env or as an environment variable.\n" +
			"Find your SSH key fingerprint at: https://cloud.digitalocean.com/account/security"
		);
	}

	// Expand ~ to home directory
	const expandedKeyPath = sshPrivateKeyPath.replace(/^~/, os.homedir());

	return {
		digitalOceanToken,
		sshKeyFingerprint,
		sshPrivateKeyPath: expandedKeyPath,
	};
}

/**
 * Get SSH configuration for connecting to droplets.
 */
export function getSshConfig(config: InfraConfig): SshConfig {
	return {
		privateKeyPath: config.sshPrivateKeyPath,
		username: "root",
		port: 22,
	};
}

/**
 * Read the SSH private key from disk.
 * Throws an error if the file doesn't exist.
 */
export function readSshPrivateKey(config: InfraConfig): string {
	const keyPath = config.sshPrivateKeyPath;

	if (!fs.existsSync(keyPath)) {
		throw new Error(
			`SSH private key not found at: ${keyPath}\n` +
			"Set SSH_PRIVATE_KEY_PATH in apps/load-tests/.env to the correct path."
		);
	}

	return fs.readFileSync(keyPath, "utf-8");
}

