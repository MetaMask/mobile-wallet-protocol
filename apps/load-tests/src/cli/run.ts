#!/usr/bin/env node
import { fork, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import { printResults } from "../output/formatter.js";
import type { TestResults } from "../output/types.js";
import { writeResults } from "../output/writer.js";
import { aggregateScenarioResults, printWorkerSummary } from "../results/aggregate.js";
import {
	type AsyncDeliveryOptions,
	type AsyncDeliveryResult,
	isValidScenarioName,
	type RealisticSessionOptions,
	type RealisticSessionResult,
	runScenario,
	type ScenarioOptions,
	type ScenarioResult,
	type SteadyMessagingOptions,
	type SteadyMessagingResult,
} from "../scenarios/index.js";
import type { ScenarioName } from "../scenarios/types.js";
import { calculateConnectTimeStats } from "../utils/stats.js";
import { getWorkerCount, parseWorkersOption, type WorkerConfig, type WorkerMessage } from "./worker-types.js";

interface CliOptions {
	target: string;
	scenario: string;
	connections: string;
	connectionPairs: string;
	duration: string;
	rampUp: string;
	messagesPerSession: string;
	delay: string;
	messageInterval: string;
	output?: string;
	workers?: string;
}

/** High-fidelity scenarios use connection pairs (dApp + Wallet) */
function isHighFidelityScenario(scenario: string): boolean {
	return ["realistic-session", "async-delivery", "steady-messaging"].includes(scenario);
}

function parseOptions(cli: CliOptions): ScenarioOptions {
	// High-fidelity scenarios use --connection-pairs, low-fidelity use --connections
	const count = isHighFidelityScenario(cli.scenario)
		? Number.parseInt(cli.connectionPairs, 10)
		: Number.parseInt(cli.connections, 10);

	return {
		target: cli.target,
		connections: count,
		durationSec: Number.parseInt(cli.duration, 10),
		rampUpSec: Number.parseInt(cli.rampUp, 10),
	};
}

function parseRealisticSessionOptions(cli: CliOptions): RealisticSessionOptions {
	return {
		...parseOptions(cli),
		messagesPerSession: Number.parseInt(cli.messagesPerSession, 10),
	};
}

function parseAsyncDeliveryOptions(cli: CliOptions): AsyncDeliveryOptions {
	return {
		...parseOptions(cli),
		delaySec: Number.parseInt(cli.delay, 10),
	};
}

function parseSteadyMessagingOptions(cli: CliOptions): SteadyMessagingOptions {
	return {
		...parseOptions(cli),
		messageIntervalSec: Number.parseInt(cli.messageInterval, 10),
	};
}

function isRealisticSessionResult(result: ScenarioResult | RealisticSessionResult | AsyncDeliveryResult): result is RealisticSessionResult {
	return "handshake" in result && "messages" in result;
}

function isAsyncDeliveryResult(result: ScenarioResult | RealisticSessionResult | AsyncDeliveryResult | SteadyMessagingResult): result is AsyncDeliveryResult {
	return "recovery" in result && "delaySeconds" in result;
}

function isSteadyMessagingResult(result: ScenarioResult | RealisticSessionResult | AsyncDeliveryResult | SteadyMessagingResult): result is SteadyMessagingResult {
	return "messaging" in result && "latencyOverTime" in result;
}

type AnyOptions = ScenarioOptions | RealisticSessionOptions | AsyncDeliveryOptions | SteadyMessagingOptions;
type AnyResult = ScenarioResult | RealisticSessionResult | AsyncDeliveryResult | SteadyMessagingResult;

function buildTestResults(scenarioName: string, options: AnyOptions, result: AnyResult): TestResults {
	const { connections } = result;

	const testResults: TestResults = {
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
				successRate: connections.attempted > 0 ? (connections.successful / connections.attempted) * 100 : 0,
				immediate: connections.immediate,
				recovered: connections.recovered,
			},
			timing: {
				totalTimeMs: result.timing.totalTimeMs,
				connectionsPerSec: result.timing.totalTimeMs > 0 ? (connections.attempted / result.timing.totalTimeMs) * 1000 : 0,
			},
			connectTime: calculateConnectTimeStats(result.timing.connectionLatencies),
			retries: {
				totalRetries: result.retries.totalRetries,
				avgRetriesPerConnection: connections.attempted > 0 ? result.retries.totalRetries / connections.attempted : 0,
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

	// Add realistic-session specific fields
	if (isRealisticSessionResult(result)) {
		const realisticOptions = options as RealisticSessionOptions;
		testResults.config.messagesPerSession = realisticOptions.messagesPerSession;

		testResults.results.handshake = {
			attempted: result.handshake.attempted,
			successful: result.handshake.successful,
			failed: result.handshake.failed,
			successRate: result.handshake.attempted > 0 ? (result.handshake.successful / result.handshake.attempted) * 100 : 0,
			latency: calculateConnectTimeStats(result.handshake.latencies),
		};

		testResults.results.messages = {
			sent: result.messages.sent,
			received: result.messages.received,
			failed: result.messages.failed,
			deliveryRate: result.messages.sent > 0 ? (result.messages.received / result.messages.sent) * 100 : 0,
			latency: calculateConnectTimeStats(result.messages.latencies),
		};
	}

	// Add async-delivery specific fields
	if (isAsyncDeliveryResult(result)) {
		const asyncOptions = options as AsyncDeliveryOptions;
		testResults.config.delaySec = asyncOptions.delaySec;

		testResults.results.recovery = {
			attempted: result.recovery.attempted,
			received: result.recovery.received,
			failed: result.recovery.failed,
			deliveryRate: result.recovery.attempted > 0 ? (result.recovery.received / result.recovery.attempted) * 100 : 0,
			latency: calculateConnectTimeStats(result.recovery.latencies),
		};
	}

	// Add steady-messaging specific fields
	if (isSteadyMessagingResult(result)) {
		const steadyOptions = options as SteadyMessagingOptions;
		testResults.config.messageIntervalSec = steadyOptions.messageIntervalSec;

		// Use 'messages' field (same as realistic-session) for compatibility with formatter
		testResults.results.messages = {
			sent: result.messaging.totalExchanges,
			received: result.messaging.successful,
			failed: result.messaging.failed,
			deliveryRate: result.messaging.totalExchanges > 0 ? (result.messaging.successful / result.messaging.totalExchanges) * 100 : 0,
			latency: calculateConnectTimeStats(result.messaging.latencies),
		};

		testResults.results.steadyMessaging = {
			durationSeconds: result.durationSeconds,
			messageIntervalSeconds: result.messageIntervalSeconds,
			disconnects: result.stability.disconnects,
			latencyOverTime: result.latencyOverTime,
		};
	}

	return testResults;
}

/**
 * Run the scenario with multiple worker processes.
 * Each worker handles a fraction of the total connections.
 */
async function runWithWorkers(
	scenario: ScenarioName,
	options: ScenarioOptions,
	workerCount: number,
): Promise<ScenarioResult> {
	const connectionsPerWorker = Math.ceil(options.connections / workerCount);
	const rampUpPerWorker = options.rampUpSec; // Each worker uses full ramp-up time

	console.log(chalk.cyan(`[multi-worker] Spawning ${workerCount} workers, ${connectionsPerWorker} connections each`));
	console.log("");

	// Get the path to the worker script
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = path.dirname(__filename);
	const workerPath = path.join(__dirname, "worker.js");

	// Spawn workers
	const workers: ChildProcess[] = [];
	const results: Array<{ workerId: number; result: ScenarioResult }> = [];
	const errors: Array<{ workerId: number; error: string }> = [];

	const workerPromises = Array.from({ length: workerCount }, (_, i) => {
		return new Promise<void>((resolve) => {
			const worker = fork(workerPath, [], {
				stdio: ["pipe", "pipe", "pipe", "ipc"],
			});
			workers.push(worker);

			// Handle messages from worker
			worker.on("message", (message: WorkerMessage) => {
				if (message.type === "result") {
					results.push({ workerId: message.workerId, result: message.result });
					console.log(chalk.green(`[multi-worker] Worker ${message.workerId} completed`));
					resolve();
				} else if (message.type === "error") {
					errors.push({ workerId: message.workerId, error: message.error });
					console.log(chalk.red(`[multi-worker] Worker ${message.workerId} error: ${message.error}`));
					resolve();
				}
			});

			// Handle worker exit
			worker.on("exit", (code) => {
				if (code !== 0 && code !== null) {
					const errorMsg = `Worker ${i} exited with code ${code}`;
					if (!errors.find((e) => e.workerId === i)) {
						errors.push({ workerId: i, error: errorMsg });
					}
					console.log(chalk.red(`[multi-worker] ${errorMsg}`));
					resolve();
				}
			});

			// Handle worker errors
			worker.on("error", (err) => {
				errors.push({ workerId: i, error: err.message });
				console.log(chalk.red(`[multi-worker] Worker ${i} spawn error: ${err.message}`));
				resolve();
			});

			// Calculate connections for this worker (last worker may get fewer)
			const isLastWorker = i === workerCount - 1;
			const remainingConnections = options.connections - connectionsPerWorker * i;
			const workerConnections = isLastWorker
				? Math.min(connectionsPerWorker, remainingConnections)
				: connectionsPerWorker;

			// Send configuration to worker
			const config: WorkerConfig = {
				workerId: i,
				totalWorkers: workerCount,
				scenario,
				options: {
					...options,
					connections: workerConnections,
					rampUpSec: rampUpPerWorker,
				},
			};
			worker.send(config);
		});
	});

	// Wait for all workers to complete
	await Promise.all(workerPromises);

	// Check for errors
	if (errors.length > 0) {
		console.log("");
		console.log(chalk.red(`[multi-worker] ${errors.length} worker(s) failed:`));
		for (const err of errors) {
			console.log(chalk.red(`  Worker ${err.workerId}: ${err.error}`));
		}
	}

	if (results.length === 0) {
		throw new Error("All workers failed, no results to aggregate");
	}

	// Aggregate results
	console.log("");
	console.log(chalk.cyan(`[multi-worker] Aggregating results from ${results.length} worker(s)...`));

	const aggregated = aggregateScenarioResults(results);
	printWorkerSummary(aggregated);

	return aggregated.result;
}

const program = new Command();

program
	.name("start")
	.description("Run load tests against a Centrifugo relay server")
	.version("0.0.1")
	.requiredOption("--target <url>", "WebSocket URL of the relay server")
	.option("--scenario <name>", "Scenario: connection-storm, steady-state, realistic-session, async-delivery, steady-messaging", "connection-storm")
	.option("--connections <number>", "Number of raw connections (low-fidelity scenarios)", "100")
	.option("--connection-pairs <number>", "Number of connection pairs (high-fidelity scenarios)", "100")
	.option("--duration <seconds>", "Test duration in seconds (for steady-state, steady-messaging)", "60")
	.option("--ramp-up <seconds>", "Seconds to ramp up to full connection count", "10")
	.option("--messages-per-session <number>", "Messages to exchange per session (realistic-session only)", "3")
	.option("--delay <seconds>", "Seconds to wait before reconnect (async-delivery only)", "30")
	.option("--message-interval <seconds>", "Seconds between message exchanges (steady-messaging only)", "5")
	.option("--output <path>", "Path to write JSON results")
	.option("--workers <count>", "Number of worker processes (or 'auto' for CPU count). Distributes load across workers.")
	.action(async (cli: CliOptions) => {
		if (!isValidScenarioName(cli.scenario)) {
			console.error(chalk.red(`[load-test] Unknown scenario: ${cli.scenario}`));
			console.error(chalk.yellow("[load-test] Available: connection-storm, steady-state, realistic-session, async-delivery, steady-messaging"));
			process.exit(1);
		}

		// Parse options based on scenario
		let options: AnyOptions;
		if (cli.scenario === "realistic-session") {
			options = parseRealisticSessionOptions(cli);
		} else if (cli.scenario === "async-delivery") {
			options = parseAsyncDeliveryOptions(cli);
		} else if (cli.scenario === "steady-messaging") {
			options = parseSteadyMessagingOptions(cli);
		} else {
			options = parseOptions(cli);
		}

		// Print configuration
		console.log(chalk.bold.blue("╔══════════════════════════════════════╗"));
		console.log(chalk.bold.blue("║       LOAD TEST RUNNER               ║"));
		console.log(chalk.bold.blue("╚══════════════════════════════════════╝"));
		console.log("");
		console.log(chalk.bold("Configuration:"));
		console.log(`  Target:      ${chalk.dim(options.target)}`);
		console.log(`  Scenario:    ${chalk.cyan(cli.scenario)}`);
		if (isHighFidelityScenario(cli.scenario)) {
			console.log(`  Connection Pairs: ${chalk.bold(options.connections)}`);
		} else {
			console.log(`  Connections: ${chalk.bold(options.connections)}`);
		}
		if (cli.scenario === "steady-state") {
			console.log(`  Duration:    ${options.durationSec}s`);
		}
		console.log(`  Ramp-up:     ${options.rampUpSec}s`);
		if (cli.scenario === "realistic-session") {
			console.log(`  Messages:    ${(options as RealisticSessionOptions).messagesPerSession} per pair`);
		}
		if (cli.scenario === "async-delivery") {
			console.log(`  Delay:       ${(options as AsyncDeliveryOptions).delaySec}s`);
		}
		if (cli.scenario === "steady-messaging") {
			console.log(`  Duration:    ${options.durationSec}s`);
			console.log(`  Msg Interval: ${(options as SteadyMessagingOptions).messageIntervalSec}s`);
		}
		if (cli.output) {
			console.log(`  Output:      ${chalk.dim(cli.output)}`);
		}

		// Parse workers option
		let workerCount = 1;
		if (cli.workers) {
			const workerOption = parseWorkersOption(cli.workers);
			workerCount = getWorkerCount(workerOption);
			console.log(`  Workers:     ${chalk.cyan(workerCount)} ${cli.workers === "auto" ? "(auto-detected)" : ""}`);
		}
		console.log("");

		// Run the scenario (single or multi-worker)
		let result: AnyResult;
		if (workerCount > 1) {
			// Multi-worker mode - only supports low-fidelity scenarios for now
			if (isHighFidelityScenario(cli.scenario)) {
				console.log(chalk.yellow("[multi-worker] Warning: Multi-worker mode is experimental for high-fidelity scenarios"));
			}
			result = await runWithWorkers(cli.scenario as ScenarioName, options, workerCount);
		} else {
			result = await runScenario(cli.scenario, options);
		}

		const testResults = buildTestResults(cli.scenario, options, result);

		console.log("");
		printResults(testResults);

		if (cli.output) {
			console.log("");
			writeResults(cli.output, testResults);
		}

		console.log("");
		console.log(chalk.green("✓ Done"));
		process.exit(0);
	});

program.parse();
