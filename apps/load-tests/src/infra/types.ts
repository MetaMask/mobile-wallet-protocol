/**
 * Droplet information returned from DigitalOcean API.
 */
export interface DropletInfo {
	id: number;
	name: string;
	status: "new" | "active" | "off" | "archive";
	ip: string | null;
	region: string;
	size: string;
	createdAt: string;
}

/**
 * Options for creating a droplet via the API.
 */
export interface CreateDropletOptions {
	name: string;
	region: string;
	size: string;
	image: string;
	sshKeyFingerprint: string;
	userData?: string;
}

/**
 * Options for the create command.
 */
export interface CreateOptions {
	count: number;
	namePrefix: string;
	branch: string;
}

/**
 * Result of executing a command on a droplet.
 */
export interface ExecResult {
	dropletName: string;
	dropletIp: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	error?: string;
}

/**
 * Infrastructure configuration loaded from environment.
 */
export interface InfraConfig {
	digitalOceanToken: string;
	sshKeyFingerprint: string;
	sshPrivateKeyPath: string;
}

/**
 * SSH connection configuration.
 */
export interface SshConfig {
	privateKeyPath: string;
	username: string;
	port: number;
}

// Hardcoded droplet settings
export const DROPLET_REGION = "nyc1";
export const DROPLET_SIZE = "s-4vcpu-8gb"; // 4 cores, 8GB RAM for baseline testing
export const DROPLET_IMAGE = "ubuntu-24-04-x64";
export const DROPLET_HOURLY_COST = 0.071; // USD per hour for s-4vcpu-8gb

