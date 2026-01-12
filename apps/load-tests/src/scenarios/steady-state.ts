import chalk from "chalk";
import {
	CentrifugeClient,
	type ConnectionResult,
} from "../client/centrifuge-client.js";
import {
	createConnectionProgressBar,
	startProgressBar,
	stopProgressBar,
	updateProgressBar,
} from "../utils/progress.js";
import { sleep } from "../utils/timing.js";
import type { ScenarioOptions, ScenarioResult } from "./types.js";

/**
 * Steady state scenario:
 * 1. Ramp up connections over rampUpSec (in parallel with proper pacing)
 * 2. Hold connections for durationSec
 * 3. Track disconnects during hold
 * 4. Disconnect all at end
 */
export async function runSteadyState(
	options: ScenarioOptions,
): Promise<ScenarioResult> {
	const { target, connections, durationSec, rampUpSec } = options;

	console.log(
		`${chalk.cyan("[steady-state]")} Ramping up to ${chalk.bold(connections)} connections over ${rampUpSec}s...`,
	);
	console.log("");

	const clients: CentrifugeClient[] = [];
	const connectionResults: ConnectionResult[] = [];
	let peakDisconnects = 0;
	let reconnectsDuringHold = 0;
	let previousDisconnectCount = 0;

	const rampUpStart = performance.now();
	const connectionDelay = (rampUpSec * 1000) / connections;

	// Create progress bar
	const progressBar = createConnectionProgressBar("[steady-state]");
	startProgressBar(progressBar, connections);

	// Ramp up phase - fire connections in parallel with pacing
	const connectPromises: Promise<void>[] = [];

	for (let i = 0; i < connections; i++) {
		const client = new CentrifugeClient({ url: target });
		clients.push(client);

		// Fire connection (don't await - let it run in parallel)
		const connectPromise = client.connect().then((result) => {
			connectionResults.push(result);
			const immediate = connectionResults.filter((r) => r.outcome === "immediate").length;
			const recovered = connectionResults.filter((r) => r.outcome === "recovered").length;
			const failed = connectionResults.filter((r) => r.outcome === "failed").length;
			updateProgressBar(progressBar, connectionResults.length, { immediate, recovered, failed });
		});
		connectPromises.push(connectPromise);

		// Pace the connection starts (but don't wait for connection to complete)
		if (i < connections - 1 && connectionDelay > 0) {
			await sleep(connectionDelay);
		}
	}

	// Wait for all connections to complete
	await Promise.all(connectPromises);
	stopProgressBar(progressBar);

	const rampUpTime = performance.now() - rampUpStart;
	const successfulConnections = connectionResults.filter((r) => r.success).length;

	console.log("");
	console.log(
		`${chalk.cyan("[steady-state]")} Ramp complete: ${chalk.green(successfulConnections)}/${connections} connected in ${Math.round(rampUpTime)}ms`,
	);

	if (successfulConnections === 0) {
		console.log(chalk.red("[steady-state] No successful connections, skipping hold phase"));
		return buildResult(connectionResults, connections, rampUpTime, 0, 0, 0, 0);
	}

	// Hold phase - keep connections open and monitor
	console.log(`${chalk.cyan("[steady-state]")} Holding for ${chalk.bold(durationSec)}s...`);

	const holdStart = performance.now();
	const holdEndTime = holdStart + durationSec * 1000;
	let lastLogTime = holdStart;
	const logInterval = 5000; // Log every 5 seconds

	while (performance.now() < holdEndTime) {
		// Check for disconnects
		const currentActive = clients.filter((c) => c.isConnected()).length;
		const currentDisconnectCount = successfulConnections - currentActive;

		// Track peak disconnects (high water mark)
		if (currentDisconnectCount > peakDisconnects) {
			peakDisconnects = currentDisconnectCount;
		}

		// Track reconnections: if disconnect count decreased, clients reconnected
		if (currentDisconnectCount < previousDisconnectCount) {
			reconnectsDuringHold += previousDisconnectCount - currentDisconnectCount;
		}
		previousDisconnectCount = currentDisconnectCount;

		// Log status periodically
		if (performance.now() - lastLogTime >= logInterval) {
			const elapsed = Math.round((performance.now() - holdStart) / 1000);
			const activeColor = currentActive === successfulConnections ? chalk.green : chalk.yellow;
			const disconnectColor = currentDisconnectCount === 0 ? chalk.green : chalk.red;
			console.log(
				`${chalk.cyan("[steady-state]")} ${chalk.dim(`[${elapsed}s]`)} Active: ${activeColor(currentActive)}/${successfulConnections} | Disconnected: ${disconnectColor(currentDisconnectCount)} (peak: ${peakDisconnects}) | Reconnects: ${reconnectsDuringHold}`,
			);
			lastLogTime = performance.now();
		}

		await sleep(100); // Check every 100ms
	}

	const holdDuration = performance.now() - holdStart;

	// Final check
	const finalActive = clients.filter((c) => c.isConnected()).length;
	const finalDisconnects = successfulConnections - finalActive;

	const activeColor = finalActive === successfulConnections ? chalk.green : chalk.yellow;
	const disconnectColor = finalDisconnects === 0 ? chalk.green : chalk.red;
	console.log(
		`${chalk.cyan("[steady-state]")} Hold complete: ${activeColor(finalActive)}/${successfulConnections} active | Final disconnects: ${disconnectColor(finalDisconnects)} | Peak: ${peakDisconnects} | Reconnects: ${reconnectsDuringHold}`,
	);

	// Disconnect all clients
	console.log(`${chalk.cyan("[steady-state]")} Disconnecting clients...`);
	for (const client of clients) {
		client.disconnect();
	}

	// Connection stability = percentage that stayed connected the whole time
	const connectionStability =
		successfulConnections > 0
			? ((successfulConnections - finalDisconnects) / successfulConnections) * 100
			: 0;

	return buildResult(
		connectionResults,
		connections,
		rampUpTime,
		holdDuration,
		finalDisconnects,
		peakDisconnects,
		reconnectsDuringHold,
		connectionStability,
	);
}

function buildResult(
	connectionResults: ConnectionResult[],
	totalConnections: number,
	rampUpTimeMs: number,
	holdDurationMs: number,
	currentDisconnects: number,
	peakDisconnects: number,
	reconnectsDuringHold: number,
	connectionStability = 0,
): ScenarioResult {
	const immediate = connectionResults.filter((r) => r.outcome === "immediate");
	const recovered = connectionResults.filter((r) => r.outcome === "recovered");
	const failed = connectionResults.filter((r) => r.outcome === "failed");
	const successful = connectionResults.filter((r) => r.success);
	const latencies = successful.map((r) => r.connectionTimeMs);
	const totalRetries = connectionResults.reduce((sum, r) => sum + r.retryCount, 0);

	return {
		connections: {
			attempted: totalConnections,
			successful: successful.length,
			failed: failed.length,
			immediate: immediate.length,
			recovered: recovered.length,
		},
		timing: {
			totalTimeMs: rampUpTimeMs + holdDurationMs,
			connectionLatencies: latencies,
		},
		retries: {
			totalRetries,
		},
		steadyState: {
			rampUpTimeMs,
			holdDurationMs,
			currentDisconnects,
			peakDisconnects,
			reconnectsDuringHold,
			connectionStability,
		},
	};
}
