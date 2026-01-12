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
		latency: {
			min: number;
			max: number;
			avg: number;
			p95: number;
		} | null;
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
	};
}
