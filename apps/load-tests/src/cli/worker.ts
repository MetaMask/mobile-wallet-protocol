#!/usr/bin/env node
/**
 * Worker process entry point for multi-worker load testing.
 *
 * This script is spawned by the coordinator (run.ts) via child_process.fork().
 * It receives configuration via IPC, runs the scenario, and sends results back.
 *
 * Usage: This file is not meant to be run directly. It's spawned by the coordinator.
 */

import { runScenario } from "../scenarios/index.js";
import type { ScenarioName } from "../scenarios/types.js";
import type { WorkerConfig, WorkerErrorMessage, WorkerResultMessage } from "./worker-types.js";

/**
 * Send a message to the coordinator process.
 */
function sendToCoordinator(message: WorkerResultMessage | WorkerErrorMessage): void {
	if (process.send) {
		process.send(message);
	} else {
		// Not running as a forked process - shouldn't happen
		console.error("[worker] Not running as forked process, cannot send message");
	}
}

/**
 * Handle incoming configuration from the coordinator.
 */
async function handleConfig(config: WorkerConfig): Promise<void> {
	const { workerId, scenario, options } = config;

	// Suppress console output in workers to avoid cluttering the coordinator's output
	// The coordinator will handle all progress display
	const originalLog = console.log;
	const originalError = console.error;

	// Only suppress if we're in a worker (not the main process)
	if (process.send) {
		console.log = () => { };
		console.error = () => { };
	}

	try {
		// Run the scenario
		const result = await runScenario(scenario as ScenarioName, options);

		// Restore console for result sending
		console.log = originalLog;
		console.error = originalError;

		// Send result back to coordinator
		sendToCoordinator({
			type: "result",
			workerId,
			result,
		});
	} catch (error) {
		// Restore console for error reporting
		console.log = originalLog;
		console.error = originalError;

		sendToCoordinator({
			type: "error",
			workerId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

// Listen for configuration from the coordinator
process.on("message", (message: unknown) => {
	const config = message as WorkerConfig;

	// Validate the message has the expected shape
	if (
		typeof config.workerId !== "number" ||
		typeof config.scenario !== "string" ||
		typeof config.options !== "object"
	) {
		sendToCoordinator({
			type: "error",
			workerId: -1,
			error: "Invalid configuration received",
		});
		return;
	}

	// Handle the configuration
	handleConfig(config).catch((error) => {
		sendToCoordinator({
			type: "error",
			workerId: config.workerId,
			error: error instanceof Error ? error.message : String(error),
		});
	});
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
	sendToCoordinator({
		type: "error",
		workerId: -1,
		error: `Uncaught exception: ${error.message}`,
	});
	process.exit(1);
});

process.on("unhandledRejection", (reason) => {
	sendToCoordinator({
		type: "error",
		workerId: -1,
		error: `Unhandled rejection: ${reason}`,
	});
	process.exit(1);
});
