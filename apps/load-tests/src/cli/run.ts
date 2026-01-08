#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import {
	getCurrentEnvironment,
	getEnvironmentConfig,
	isValidEnvironmentName,
} from "../config/environments.js";
import { printResults } from "../output/formatter.js";
import type { TestResults } from "../output/types.js";
import { getUploader } from "../output/uploader.js";
import {
	isValidScenarioName,
	runScenario,
	type ScenarioOptions,
	type ScenarioResult,
} from "../scenarios/index.js";
import { calculateLatencyStats } from "../utils/stats.js";
import { collectMetadata } from "../utils/metadata.js";

/**
 * CLI options as parsed by commander (strings).
 */
interface CliOptions {
	target?: string;
	environment?: string;
	scenario: string;
	connections: string;
	duration: string;
	rampUp: string;
	output?: string;
}

/**
 * Parse CLI options into ScenarioOptions (with proper types).
 */
function parseOptions(cli: CliOptions): ScenarioOptions {
	return {
		target: cli.target,
		connections: Number.parseInt(cli.connections, 10),
		durationSec: Number.parseInt(cli.duration, 10),
		rampUpSec: Number.parseInt(cli.rampUp, 10),
	};
}

/**
 * Transform ScenarioResult into TestResults for output.
 */
function buildTestResults(
	scenarioName: string,
	options: ScenarioOptions,
	result: ScenarioResult,
	metadata: { environment?: string; gitSha?: string; runnerType: string; containerId?: string },
): TestResults {
	const { connections } = result;

	return {
		scenario: scenarioName,
		timestamp: new Date().toISOString(),
		target: options.target,
		environment: metadata.environment,
		gitSha: metadata.gitSha,
		runnerType: metadata.runnerType,
		containerId: metadata.containerId,
		config: {
			connections: options.connections,
			durationSec: options.durationSec,
			rampUpSec: options.rampUpSec,
		},
		results: {
			connections: {
				attempted: connections.attempted,
				successful: connections.successful,
				failed: connections.failed,
				successRate:
					connections.attempted > 0
						? (connections.successful / connections.attempted) * 100
						: 0,
				immediate: connections.immediate,
				recovered: connections.recovered,
			},
			timing: {
				totalTimeMs: result.timing.totalTimeMs,
				connectionsPerSec:
					result.timing.totalTimeMs > 0
						? (connections.attempted / result.timing.totalTimeMs) * 1000
						: 0,
			},
			latency: calculateLatencyStats(result.timing.connectionLatencies),
			retries: {
				totalRetries: result.retries.totalRetries,
				avgRetriesPerConnection:
					connections.attempted > 0
						? result.retries.totalRetries / connections.attempted
						: 0,
			},
			steadyState: result.steadyState
				? {
					holdDurationMs: result.steadyState.holdDurationMs,
					currentDisconnects: result.steadyState.currentDisconnects,
					peakDisconnects: result.steadyState.peakDisconnects,
					reconnectsDuringHold: result.steadyState.reconnectsDuringHold,
					connectionStability: result.steadyState.connectionStability,
				}
				: undefined,
		},
	};
}

const program = new Command();

program
	.name("start")
	.description("Run load tests against a Centrifugo relay server")
	.version("0.0.1")
	.option("--target <url>", "WebSocket URL of the relay server (required if --environment not provided)")
	.option(
		"--environment <name>",
		"Environment name: dev, uat, prod (resolves relay URL from config)",
	)
	.option(
		"--scenario <name>",
		"Scenario to run: connection-storm, steady-state",
		"connection-storm",
	)
	.option("--connections <number>", "Number of connections to create", "100")
	.option(
		"--duration <seconds>",
		"Test duration in seconds (for steady-state)",
		"60",
	)
	.option(
		"--ramp-up <seconds>",
		"Seconds to ramp up to full connection count",
		"10",
	)
	.option("--output <path>", "Path to write JSON results")
	.action(async (cli: CliOptions) => {
		// Determine environment
		let environment: string | undefined;
		let targetUrl: string;

		if (cli.environment) {
			// Validate environment name
			if (!isValidEnvironmentName(cli.environment)) {
				console.error(chalk.red(`[load-test] Invalid environment: ${cli.environment}`));
				console.error(chalk.yellow("[load-test] Valid environments: dev, uat, prod"));
				process.exit(1);
			}

			// Get environment config
			const envConfig = getEnvironmentConfig(cli.environment);
			if (!envConfig) {
				console.error(chalk.red(`[load-test] Environment '${cli.environment}' not configured`));
				console.error(chalk.yellow("[load-test] Set RELAY_URL_DEV, RELAY_URL_UAT, or RELAY_URL_PROD environment variable"));
				console.error(chalk.yellow("        or create config/environments.json file"));
				process.exit(1);
			}

			environment = cli.environment;
			targetUrl = envConfig.relayUrl;

			// Warn if --target was also provided
			if (cli.target) {
				console.warn(chalk.yellow(`[load-test] Warning: --target ignored when using --environment`));
			}
		} else if (cli.target) {
			// Use explicit target
			targetUrl = cli.target;
			// Try to detect environment from LOAD_TEST_ENVIRONMENT
			const currentEnv = getCurrentEnvironment();
			if (currentEnv) {
				environment = currentEnv;
			}
		} else {
			console.error(chalk.red("[load-test] Either --target or --environment must be provided"));
			process.exit(1);
		}

		// Validate scenario name
		if (!isValidScenarioName(cli.scenario)) {
			console.error(chalk.red(`[load-test] Unknown scenario: ${cli.scenario}`));
			console.error(chalk.yellow("[load-test] Available scenarios: connection-storm, steady-state"));
			process.exit(1);
		}

		// Parse options
		const options = parseOptions({ ...cli, target: targetUrl });

		// Collect metadata
		const metadata = collectMetadata(environment);

		// Print configuration
		console.log(chalk.bold.blue("╔══════════════════════════════════════╗"));
		console.log(chalk.bold.blue("║       LOAD TEST RUNNER               ║"));
		console.log(chalk.bold.blue("╚══════════════════════════════════════╝"));
		console.log("");
		console.log(chalk.bold("Configuration:"));
		if (environment) {
			console.log(`  Environment: ${chalk.cyan(environment)}`);
		}
		console.log(`  Target:      ${chalk.dim(options.target)}`);
		console.log(`  Scenario:    ${chalk.cyan(cli.scenario)}`);
		console.log(`  Connections: ${chalk.bold(options.connections)}`);
		console.log(`  Duration:    ${options.durationSec}s`);
		console.log(`  Ramp-up:     ${options.rampUpSec}s`);
		console.log(`  Runner:      ${chalk.dim(metadata.runnerType)}`);
		if (metadata.containerId) {
			console.log(`  Container:   ${chalk.dim(metadata.containerId)}`);
		}
		if (cli.output) {
			console.log(`  Output:      ${chalk.dim(cli.output)}`);
		}
		console.log("");

		// Run scenario
		const result = await runScenario(cli.scenario, options);

		// Build and display results
		const testResults = buildTestResults(cli.scenario, options, result, metadata);

		console.log("");
		printResults(testResults);

		if (cli.output) {
			console.log("");
			const uploader = getUploader();
			await uploader.upload(testResults, { path: cli.output });
		}

		console.log("");
		console.log(chalk.green("✓ Done"));
	});

program.parse();
