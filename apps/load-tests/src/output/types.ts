/**
 * Latency statistics structure used for various timing metrics.
 */
export interface LatencyStats {
	min: number;
	max: number;
	avg: number;
	p50: number;
	p95: number;
	p99: number;
}

/**
 * Complete test results structure for JSON output.
 * This is the final output format - built from ScenarioResult in the CLI.
 */
export interface TestResults {
	scenario: string;
	timestamp: string;
	target: string;
	config: {
		connections: number;
		durationSec: number;
		rampUpSec: number;
		/** Only present for realistic-session scenario */
		messagesPerSession?: number;
		/** Only present for async-delivery scenario */
		delaySec?: number;
		/** Only present for steady-messaging scenario */
		messageIntervalSec?: number;
	};
	results: {
		connections: {
			attempted: number;
			successful: number;
			failed: number;
			successRate: number;
			/** Connected on first try */
			immediate: number;
			/** Failed initially but recovered via reconnect */
			recovered: number;
		};
		timing: {
			totalTimeMs: number;
			connectionsPerSec: number;
		};
		/** Connection establishment time (NOT message RTT) */
		connectTime: LatencyStats | null;
		retries: {
			totalRetries: number;
			avgRetriesPerConnection: number;
		};
		steadyState?: {
			holdDurationMs: number;
			/** Current number of disconnected clients at end of hold */
			currentDisconnects: number;
			/** Peak number of disconnects seen at any point during hold */
			peakDisconnects: number;
			/** Number of times clients reconnected during hold */
			reconnectsDuringHold: number;
			connectionStability: number;
		};
		/** High-fidelity handshake metrics (realistic-session only) */
		handshake?: {
			attempted: number;
			successful: number;
			failed: number;
			successRate: number;
			latency: LatencyStats | null;
		};
		/** High-fidelity message metrics (realistic-session only) */
		messages?: {
			sent: number;
			received: number;
			failed: number;
			deliveryRate: number;
			latency: LatencyStats | null;
		};
		/** Historical message recovery metrics (async-delivery only) */
		recovery?: {
			attempted: number;
			received: number;
			failed: number;
			deliveryRate: number;
			latency: LatencyStats | null;
		};
		/** Sustained messaging metrics (steady-messaging only) */
		steadyMessaging?: {
			durationSeconds: number;
			messageIntervalSeconds: number;
			disconnects: number;
			latencyOverTime: Array<{
				timestampMs: number;
				p50: number;
				p99: number;
				exchanges: number;
			}>;
		};
	};
}
