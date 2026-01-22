import * as os from "node:os";
import type { ScenarioName, ScenarioOptions, ScenarioResult } from "../scenarios/types.js";

/**
 * Configuration sent from coordinator to worker via IPC.
 */
export interface WorkerConfig {
	/** Unique identifier for this worker (0-indexed) */
	workerId: number;
	/** Total number of workers */
	totalWorkers: number;
	/** Scenario to run */
	scenario: ScenarioName;
	/** Scenario options (connections already divided by worker count) */
	options: ScenarioOptions;
}

/**
 * Result message sent from worker to coordinator via IPC.
 */
export interface WorkerResultMessage {
	type: "result";
	workerId: number;
	result: ScenarioResult;
}

/**
 * Progress update sent from worker to coordinator via IPC.
 */
export interface WorkerProgressMessage {
	type: "progress";
	workerId: number;
	/** Number of connections completed so far */
	completed: number;
	/** Total connections for this worker */
	total: number;
}

/**
 * Error message sent from worker to coordinator via IPC.
 */
export interface WorkerErrorMessage {
	type: "error";
	workerId: number;
	error: string;
}

/**
 * Union type for all messages from worker to coordinator.
 */
export type WorkerMessage = WorkerResultMessage | WorkerProgressMessage | WorkerErrorMessage;

/**
 * Parse the workers CLI option.
 * Returns the number of workers, or "auto" to detect CPU count.
 */
export function parseWorkersOption(value: string): number | "auto" {
	if (value === "auto") {
		return "auto";
	}
	const num = Number.parseInt(value, 10);
	if (Number.isNaN(num) || num < 1) {
		throw new Error(`Invalid workers value: ${value}. Must be a positive number or "auto".`);
	}
	return num;
}

/**
 * Get the actual worker count based on the option value.
 */
export function getWorkerCount(option: number | "auto"): number {
	if (option === "auto") {
		return os.cpus().length;
	}
	return option;
}
