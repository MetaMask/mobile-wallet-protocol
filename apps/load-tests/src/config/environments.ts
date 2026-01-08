import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Environment name type.
 */
export type EnvironmentName = "dev" | "uat" | "prod";

/**
 * Environment configuration.
 */
export interface EnvironmentConfig {
	name: EnvironmentName;
	relayUrl: string;
}

/**
 * Get environment configuration from environment variables.
 * Supports RELAY_URL_DEV, RELAY_URL_UAT, RELAY_URL_PROD.
 */
function getConfigFromEnvVars(envName: EnvironmentName): EnvironmentConfig | null {
	const envVarName = `RELAY_URL_${envName.toUpperCase()}`;
	const relayUrl = process.env[envVarName];

	if (!relayUrl) {
		return null;
	}

	return {
		name: envName,
		relayUrl,
	};
}

/**
 * Get environment configuration from config file.
 * Looks for config/environments.json in the load-tests directory.
 */
function getConfigFromFile(envName: EnvironmentName): EnvironmentConfig | null {
	const configPath = path.join(__dirname, "../../config/environments.json");

	if (!fs.existsSync(configPath)) {
		return null;
	}

	try {
		const configContent = fs.readFileSync(configPath, "utf-8");
		const config = JSON.parse(configContent) as Record<string, { relayUrl: string }>;

		const envConfig = config[envName];
		if (!envConfig || !envConfig.relayUrl) {
			return null;
		}

		return {
			name: envName,
			relayUrl: envConfig.relayUrl,
		};
	} catch (error) {
		console.warn(`[load-test] Failed to read config file: ${error}`);
		return null;
	}
}

/**
 * Get environment configuration for the specified environment.
 * Checks in order:
 * 1. Environment variables (RELAY_URL_DEV, RELAY_URL_UAT, RELAY_URL_PROD)
 * 2. Config file (config/environments.json)
 *
 * @param envName - Environment name (dev, uat, prod)
 * @returns Environment configuration or null if not found
 */
export function getEnvironmentConfig(envName: string): EnvironmentConfig | null {
	if (envName !== "dev" && envName !== "uat" && envName !== "prod") {
		return null;
	}

	const normalizedEnv = envName as EnvironmentName;

	// Try environment variables first
	const envConfig = getConfigFromEnvVars(normalizedEnv);
	if (envConfig) {
		return envConfig;
	}

	// Fall back to config file
	return getConfigFromFile(normalizedEnv);
}

/**
 * Get the current environment from LOAD_TEST_ENVIRONMENT env var.
 * Falls back to null if not set.
 */
export function getCurrentEnvironment(): EnvironmentName | null {
	const env = process.env.LOAD_TEST_ENVIRONMENT;
	if (env === "dev" || env === "uat" || env === "prod") {
		return env;
	}
	return null;
}

/**
 * Validate that an environment name is valid.
 */
export function isValidEnvironmentName(name: string): name is EnvironmentName {
	return name === "dev" || name === "uat" || name === "prod";
}
