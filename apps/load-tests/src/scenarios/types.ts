/**
 * Parsed options for running a scenario.
 * These are already parsed (numbers, not strings) - CLI parsing happens in cli/run.ts
 */
export interface ScenarioOptions {
	target: string;
	connections: number;
	durationSec: number;
	rampUpSec: number;
}

/**
 * Common result type returned by all scenarios.
 * This is the "raw" result - the CLI wraps this in TestResults for output.
 */
export interface ScenarioResult {
	/** Connection metrics */
	connections: {
		attempted: number;
		successful: number;
		failed: number;
		immediate: number;
		recovered: number;
	};

	/** Timing metrics */
	timing: {
		totalTimeMs: number;
		/** Raw latencies for percentile calculation */
		connectionLatencies: number[];
	};

	/** Retry metrics */
	retries: {
		totalRetries: number;
	};

	/** Steady-state specific metrics (only present for steady-state scenario) */
	steadyState?: {
		rampUpTimeMs: number;
		holdDurationMs: number;
		currentDisconnects: number;
		peakDisconnects: number;
		reconnectsDuringHold: number;
		connectionStability: number;
	};
}

export type ScenarioName = "connection-storm" | "steady-state";

