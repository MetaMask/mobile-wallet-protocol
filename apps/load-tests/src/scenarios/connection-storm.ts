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
 * Connection storm scenario:
 * Rapidly connect many clients with optional pacing, then disconnect.
 * Tests raw connection handling capacity.
 */
export async function runConnectionStorm(
	options: ScenarioOptions,
): Promise<ScenarioResult> {
	const { target, connections, rampUpSec } = options;

	// Calculate pacing: spread connection starts over ramp-up period
	const connectionDelay = rampUpSec > 0 ? (rampUpSec * 1000) / connections : 0;

	console.log(`${chalk.cyan("[connection-storm]")} Connecting ${chalk.bold(connections)} client(s) to ${chalk.dim(target)}`);
	if (connectionDelay > 0) {
		console.log(
			`${chalk.cyan("[connection-storm]")} Pacing: ${chalk.bold((1000 / connectionDelay).toFixed(1))} conn/sec over ${rampUpSec}s`,
		);
	}
	console.log("");

	const startTime = performance.now();
	const clients: CentrifugeClient[] = [];
	const connectionResults: ConnectionResult[] = [];

	// Create progress bar
	const progressBar = createConnectionProgressBar("[connection-storm]");
	startProgressBar(progressBar, connections);

	// Create and connect all clients with pacing
	const connectPromises: Promise<void>[] = [];

	for (let i = 0; i < connections; i++) {
		const client = new CentrifugeClient({ url: target });
		clients.push(client);

		connectPromises.push(
			client.connect().then((result) => {
				connectionResults.push(result);
				const immediate = connectionResults.filter((r) => r.outcome === "immediate").length;
				const recovered = connectionResults.filter((r) => r.outcome === "recovered").length;
				const failed = connectionResults.filter((r) => r.outcome === "failed").length;
				updateProgressBar(progressBar, connectionResults.length, { immediate, recovered, failed });
			}),
		);

		// Pace connection starts (but don't wait for connection to complete)
		if (i < connections - 1 && connectionDelay > 0) {
			await sleep(connectionDelay);
		}
	}

	await Promise.all(connectPromises);
	stopProgressBar(progressBar);

	const totalTime = performance.now() - startTime;

	console.log("");

	const immediate = connectionResults.filter((r) => r.outcome === "immediate");
	const recovered = connectionResults.filter((r) => r.outcome === "recovered");
	const failed = connectionResults.filter((r) => r.outcome === "failed");
	const successful = connectionResults.filter((r) => r.success);
	const latencies = successful.map((r) => r.connectionTimeMs);
	const totalRetries = connectionResults.reduce((sum, r) => sum + r.retryCount, 0);

	// Print errors if any
	if (failed.length > 0) {
		const errorCounts = new Map<string, number>();
		for (const f of failed) {
			const err = f.error ?? "Unknown error";
			errorCounts.set(err, (errorCounts.get(err) ?? 0) + 1);
		}
		console.log(chalk.red("Errors:"));
		for (const [err, count] of errorCounts) {
			console.log(chalk.red(`  ${count}x: ${err}`));
		}
		console.log("");
	}

	// Disconnect all clients
	console.log(`${chalk.cyan("[connection-storm]")} Disconnecting clients...`);
	for (const client of clients) {
		client.disconnect();
	}

	return {
		connections: {
			attempted: connections,
			successful: successful.length,
			failed: failed.length,
			immediate: immediate.length,
			recovered: recovered.length,
		},
		timing: {
			totalTimeMs: totalTime,
			connectionLatencies: latencies,
		},
		retries: {
			totalRetries,
		},
	};
}
