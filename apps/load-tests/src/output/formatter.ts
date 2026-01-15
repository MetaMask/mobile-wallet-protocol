import chalk from "chalk";
import type { LatencyStats, TestResults } from "./types.js";

/**
 * Format latency stats as a compact string.
 */
function formatLatency(stats: LatencyStats, sloTarget?: number): string {
	const p99Color =
		sloTarget !== undefined
			? stats.p99 <= sloTarget
				? chalk.green
				: chalk.red
			: stats.p99 <= 100
				? chalk.green
				: stats.p99 <= 400
					? chalk.yellow
					: chalk.red;

	return `min=${stats.min}ms, avg=${stats.avg}ms, p50=${stats.p50}ms, p95=${stats.p95}ms, p99=${p99Color(stats.p99 + "ms")}, max=${stats.max}ms`;
}

/**
 * Print test results summary to console.
 */
export function printResults(results: TestResults): void {
	const { connections, timing, connectTime, retries, steadyState, handshake, messages, recovery, steadyMessaging } =
		results.results;

	console.log(chalk.gray("─────────────────────────────────────"));
	console.log(chalk.bold("         RESULTS SUMMARY"));
	console.log(chalk.gray("─────────────────────────────────────"));

	// Connection summary with color-coded success rate
	const successRate = connections.successRate;
	const rateColor =
		successRate >= 99 ? chalk.green : successRate >= 95 ? chalk.yellow : chalk.red;
	
	// Use "Connection Pairs" for high-fidelity scenarios, "Connections" for low-fidelity
	const isHighFidelity = handshake || recovery || steadyMessaging;
	const connectionLabel = isHighFidelity ? "Connection Pairs" : "Connections";
	console.log(
		`${connectionLabel}: ${connections.attempted} attempted, ${connections.successful} successful (${rateColor(successRate.toFixed(1) + "%")})`,
	);

	// Breakdown with icons (only for low-fidelity scenarios where immediate/recovered are meaningful)
	if (!isHighFidelity) {
		console.log(
			`  ${chalk.green("✓")} Immediate: ${connections.immediate} | ${chalk.yellow("↻")} Recovered: ${connections.recovered} | ${chalk.red("✗")} Failed: ${connections.failed}`,
		);
	}

	// Timing
	console.log(`Total time:  ${Math.round(timing.totalTimeMs)}ms`);
	console.log(`Rate:        ${timing.connectionsPerSec.toFixed(1)} conn/sec`);

	// Connection time with color-coded p95 (for low-fidelity scenarios)
	if (connectTime && !handshake) {
		console.log(`Connect:     ${formatLatency(connectTime)}`);
	}

	// Retries (only if any)
	if (retries.totalRetries > 0) {
		console.log(
			chalk.yellow(
				`Retries:     ${retries.totalRetries} total (avg ${retries.avgRetriesPerConnection.toFixed(1)} per conn)`,
			),
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

	// High-fidelity handshake metrics (realistic-session)
	if (handshake) {
		console.log("");
		console.log(chalk.bold("Handshake:"));
		const handshakeRateColor =
			handshake.successRate >= 99
				? chalk.green
				: handshake.successRate >= 95
					? chalk.yellow
					: chalk.red;
		console.log(
			`  Pairs:     ${handshake.successful}/${handshake.attempted} (${handshakeRateColor(handshake.successRate.toFixed(1) + "%")})`,
		);
		if (handshake.latency) {
			console.log(`  Latency:   ${formatLatency(handshake.latency)}`);
		}
	}

	// High-fidelity message metrics (realistic-session only - steady-messaging uses its own section)
	if (messages && !steadyMessaging) {
		console.log("");
		console.log(chalk.bold("Messages:"));
		const deliveryColor =
			messages.deliveryRate >= 99.9
				? chalk.green
				: messages.deliveryRate >= 99
					? chalk.yellow
					: chalk.red;
		console.log(
			`  Delivery:  ${messages.received}/${messages.sent} (${deliveryColor(messages.deliveryRate.toFixed(1) + "%")})`,
		);
		if (messages.failed > 0) {
			console.log(chalk.red(`  Failed:    ${messages.failed}`));
		}
		if (messages.latency) {
			// SLO target is 400ms for P99 message latency
			console.log(`  Latency:   ${formatLatency(messages.latency, 400)}`);

			// Highlight SLO compliance
			const sloStatus = messages.latency.p99 <= 400 ? chalk.green("✓ PASS") : chalk.red("✗ FAIL");
			console.log(`  SLO P99:   ${sloStatus} (target ≤ 400ms, actual ${messages.latency.p99}ms)`);
		}
	}

	// Historical recovery metrics (async-delivery)
	if (recovery) {
		console.log("");
		console.log(chalk.bold("Historical Recovery:"));
		const recoveryColor =
			recovery.deliveryRate >= 100 ? chalk.green : recovery.deliveryRate >= 99 ? chalk.yellow : chalk.red;
		console.log(`  Received:  ${recovery.received}/${recovery.attempted} (${recoveryColor(recovery.deliveryRate.toFixed(1) + "%")})`);
		if (recovery.failed > 0) {
			console.log(chalk.red(`  Failed:    ${recovery.failed}`));
		}
		if (recovery.latency) {
			console.log(`  Latency:   ${formatLatency(recovery.latency)}`);
		}
		// SLO: 100% historical recovery
		const sloStatus = recovery.deliveryRate >= 100 ? chalk.green("✓ PASS") : chalk.red("✗ FAIL");
		console.log(`  SLO:       ${sloStatus} (target 100%, actual ${recovery.deliveryRate.toFixed(1)}%)`);
	}

	// Sustained messaging metrics (steady-messaging)
	if (steadyMessaging && messages) {
		console.log("");
		console.log(chalk.bold("Sustained Messaging:"));
		console.log(`  Duration:  ${steadyMessaging.durationSeconds}s (interval: ${steadyMessaging.messageIntervalSeconds}s)`);

		const deliveryColor =
			messages.deliveryRate >= 99.9
				? chalk.green
				: messages.deliveryRate >= 99
					? chalk.yellow
					: chalk.red;
		console.log(`  Exchanges: ${messages.received}/${messages.sent} (${deliveryColor(messages.deliveryRate.toFixed(1) + "%")})`);

		if (steadyMessaging.disconnects > 0) {
			console.log(chalk.red(`  Disconnects: ${steadyMessaging.disconnects} during test`));
		}

		if (messages.latency) {
			console.log(`  Latency:   ${formatLatency(messages.latency, 400)}`);

			// SLO: P99 <= 400ms
			const sloStatus = messages.latency.p99 <= 400 ? chalk.green("✓ PASS") : chalk.red("✗ FAIL");
			console.log(`  SLO P99:   ${sloStatus} (target ≤ 400ms, actual ${messages.latency.p99}ms)`);
		}

		// Show latency trend (first vs last)
		if (steadyMessaging.latencyOverTime.length >= 2) {
			const first = steadyMessaging.latencyOverTime[0];
			const last = steadyMessaging.latencyOverTime[steadyMessaging.latencyOverTime.length - 1];
			const trendColor = last.p99 <= first.p99 * 1.2 ? chalk.green : chalk.yellow;
			console.log(`  Trend:     P99 ${Math.round(first.p99)}ms → ${trendColor(Math.round(last.p99) + "ms")} (first → last)`);
		}
	}
}
