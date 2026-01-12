import chalk from "chalk";
import type { TestResults } from "./types.js";

/**
 * Print test results summary to console.
 */
export function printResults(results: TestResults): void {
	const { connections, timing, latency, retries, steadyState } = results.results;

	console.log(chalk.gray("─────────────────────────────────────"));
	console.log(chalk.bold("         RESULTS SUMMARY"));
	console.log(chalk.gray("─────────────────────────────────────"));

	// Connection summary with color-coded success rate
	const successRate = connections.successRate;
	const rateColor = successRate >= 99 ? chalk.green : successRate >= 95 ? chalk.yellow : chalk.red;
	console.log(
		`Connections: ${connections.attempted} attempted, ${connections.successful} successful (${rateColor(successRate.toFixed(1) + "%")})`,
	);

	// Breakdown with icons
	console.log(
		`  ${chalk.green("✓")} Immediate: ${connections.immediate} | ${chalk.yellow("↻")} Recovered: ${connections.recovered} | ${chalk.red("✗")} Failed: ${connections.failed}`,
	);

	// Timing
	console.log(`Total time:  ${Math.round(timing.totalTimeMs)}ms`);
	console.log(`Rate:        ${timing.connectionsPerSec.toFixed(1)} conn/sec`);

	// Latency with color-coded p95
	if (latency) {
		const p95Color = latency.p95 <= 100 ? chalk.green : latency.p95 <= 400 ? chalk.yellow : chalk.red;
		console.log(
			`Latency:     min=${latency.min}ms, max=${latency.max}ms, avg=${latency.avg}ms, p95=${p95Color(latency.p95 + "ms")}`,
		);
	}

	// Retries (only if any)
	if (retries.totalRetries > 0) {
		console.log(
			chalk.yellow(`Retries:     ${retries.totalRetries} total (avg ${retries.avgRetriesPerConnection.toFixed(1)} per conn)`),
		);
	}

	// Steady-state specific metrics
	if (steadyState) {
		console.log(`Hold:        ${Math.round(steadyState.holdDurationMs / 1000)}s`);

		const disconnectColor = steadyState.currentDisconnects === 0 ? chalk.green : chalk.red;
		console.log(
			`Disconnects: ${disconnectColor(steadyState.currentDisconnects.toString())} current, ${steadyState.peakDisconnects} peak`,
		);

		if (steadyState.reconnectsDuringHold > 0) {
			console.log(chalk.yellow(`Reconnects:  ${steadyState.reconnectsDuringHold} during hold`));
		}

		const stabilityColor =
			steadyState.connectionStability >= 99.9
				? chalk.green
				: steadyState.connectionStability >= 99
					? chalk.yellow
					: chalk.red;
		console.log(`Stability:   ${stabilityColor(steadyState.connectionStability.toFixed(1) + "%")}`);
	}
}
