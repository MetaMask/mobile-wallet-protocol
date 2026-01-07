#!/usr/bin/env node
import { Command } from "commander";
import { printResults } from "../output/formatter.js";
import type { TestResults } from "../output/types.js";
import { writeResults } from "../output/writer.js";
import {
	isValidScenarioName,
	runScenario,
	type ScenarioOptions,
	type ScenarioResult,
} from "../scenarios/index.js";
import { calculateLatencyStats } from "../utils/stats.js";

/**
 * CLI options as parsed by commander (strings).
 */
interface CliOptions {
	target: string;
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
): TestResults {
	const { connections } = result;

	return {
		scenario: scenarioName,
		timestamp: new Date().toISOString(),
		target: options.target,
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
	.name("load-test:run")
	.description("Run load tests against a Centrifugo relay server")
	.version("0.0.1")
	.requiredOption("--target <url>", "WebSocket URL of the relay server")
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
		// Validate scenario name
		if (!isValidScenarioName(cli.scenario)) {
			console.error(`[load-test] Unknown scenario: ${cli.scenario}`);
			console.error("[load-test] Available scenarios: connection-storm, steady-state");
			process.exit(1);
		}

		// Parse options
		const options = parseOptions(cli);

		// Print configuration
		console.log("[load-test] Load Test Runner");
		console.log("[load-test] Configuration:");
		console.log(`  Target:      ${options.target}`);
		console.log(`  Scenario:    ${cli.scenario}`);
		console.log(`  Connections: ${options.connections}`);
		console.log(`  Duration:    ${options.durationSec}s`);
		console.log(`  Ramp-up:     ${options.rampUpSec}s`);
		if (cli.output) {
			console.log(`  Output:      ${cli.output}`);
		}
		console.log("");

		// Run scenario
		const result = await runScenario(cli.scenario, options);

		// Build and display results
		const testResults = buildTestResults(cli.scenario, options, result);

		console.log("");
		printResults(testResults);

		if (cli.output) {
			console.log("");
			writeResults(cli.output, testResults);
		}

		console.log("");
		console.log("[load-test] Done");
	});

program.parse();
