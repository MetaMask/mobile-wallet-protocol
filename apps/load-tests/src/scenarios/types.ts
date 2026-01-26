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
 * Extended options for realistic-session scenario.
 */
export interface RealisticSessionOptions extends ScenarioOptions {
	/** Number of request/response message pairs to exchange per session */
	messagesPerSession: number;
	/** Seconds to spread disconnects over (0 = all at once) */
	rampDownSec: number;
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

/**
 * Extended result type for realistic-session scenario.
 * Includes high-fidelity metrics for handshake and message exchange.
 */
export interface RealisticSessionResult extends ScenarioResult {
	/** Handshake metrics (protocol-level connection establishment) */
	handshake: {
		attempted: number;
		successful: number;
		failed: number;
		/** Raw handshake latencies in ms */
		latencies: number[];
	};

	/** Message exchange metrics */
	messages: {
		sent: number;
		received: number;
		failed: number;
		/** Raw message round-trip latencies in ms */
		latencies: number[];
	};
}

/**
 * Extended options for async-delivery scenario.
 */
export interface AsyncDeliveryOptions extends ScenarioOptions {
	/** Seconds to wait between sender disconnect and receiver reconnect */
	delaySec: number;
}

/**
 * Extended result type for async-delivery scenario.
 * Tests historical message recovery after wallet disconnect/reconnect.
 */
export interface AsyncDeliveryResult extends ScenarioResult {
	/** Phase 1: Initial session establishment */
	sessions: {
		attempted: number;
		successful: number;
		failed: number;
	};

	/** Phase 2: Messages sent while wallet disconnected */
	messagesSent: {
		attempted: number;
		successful: number;
		failed: number;
	};

	/** Phase 3: Historical message recovery */
	recovery: {
		attempted: number;
		received: number;
		failed: number;
		/** Time from wallet reconnect to receiving historical message */
		latencies: number[];
	};

	/** Configuration */
	delaySeconds: number;
}

/**
 * Extended options for steady-messaging scenario.
 */
export interface SteadyMessagingOptions extends ScenarioOptions {
	/** Seconds to wait between message exchanges */
	messageIntervalSec: number;
}

/**
 * Extended result type for steady-messaging scenario.
 * Tests sustained message latency under load over time.
 */
export interface SteadyMessagingResult extends ScenarioResult {
	/** Session establishment metrics */
	sessions: {
		attempted: number;
		successful: number;
		failed: number;
	};

	/** Message exchange metrics over the duration */
	messaging: {
		totalExchanges: number;
		successful: number;
		failed: number;
		/** All message round-trip latencies in ms */
		latencies: number[];
	};

	/** Connection stability during the test */
	stability: {
		/** Sessions that dropped during the test */
		disconnects: number;
	};

	/** Time-series data for detecting latency degradation */
	latencyOverTime: Array<{
		timestampMs: number;
		p50: number;
		p99: number;
		exchanges: number;
	}>;

	/** Configuration */
	durationSeconds: number;
	messageIntervalSeconds: number;
}

export type ScenarioName = "connection-storm" | "steady-state" | "realistic-session" | "async-delivery" | "steady-messaging";

