import type { TestResults } from "./types.js";

/**
 * Print test results summary to console.
 */
export function printResults(results: TestResults): void {
	console.log("─────────────────────────────────────");
	console.log("         RESULTS SUMMARY");
	console.log("─────────────────────────────────────");
	console.log(
		`Connections: ${results.results.connections.attempted} attempted, ${results.results.connections.successful} successful (${results.results.connections.successRate.toFixed(1)}%)`,
	);
	console.log(
		`  Immediate: ${results.results.connections.immediate} | Recovered: ${results.results.connections.recovered} | Failed: ${results.results.connections.failed}`,
	);
	console.log(`Total time:  ${Math.round(results.results.timing.totalTimeMs)}ms`);
	console.log(`Rate:        ${results.results.timing.connectionsPerSec.toFixed(1)} conn/sec`);

	if (results.results.latency) {
		console.log(
			`Latency:     min=${results.results.latency.min}ms, max=${results.results.latency.max}ms, avg=${results.results.latency.avg}ms, p95=${results.results.latency.p95}ms`,
		);
	}

	if (results.results.retries.totalRetries > 0) {
		console.log(
			`Retries:     ${results.results.retries.totalRetries} total (avg ${results.results.retries.avgRetriesPerConnection.toFixed(1)} per conn)`,
		);
	}

	if (results.results.steadyState) {
		console.log(`Hold:        ${Math.round(results.results.steadyState.holdDurationMs / 1000)}s`);
		console.log(
			`Disconnects: ${results.results.steadyState.currentDisconnects} current, ${results.results.steadyState.peakDisconnects} peak`,
		);
		console.log(`Reconnects:  ${results.results.steadyState.reconnectsDuringHold} during hold`);
		console.log(`Stability:   ${results.results.steadyState.connectionStability.toFixed(1)}%`);
	}
}

