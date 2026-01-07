import {
	CentrifugeClient,
	type ConnectionResult,
} from "../client/centrifuge-client.js";
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

	console.log(`[connection-storm] Connecting ${connections} client(s) to ${target}`);
	if (connectionDelay > 0) {
		console.log(
			`[connection-storm] Pacing: ${(1000 / connectionDelay).toFixed(1)} conn/sec over ${rampUpSec}s`,
		);
	}
	console.log("");

	const startTime = performance.now();
	const clients: CentrifugeClient[] = [];
	const connectionResults: ConnectionResult[] = [];

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
				process.stdout.write(
					`\r[connection-storm] Progress: ${connectionResults.length}/${connections} (✓ ${immediate} ↻ ${recovered} ✗ ${failed})`,
				);
			}),
		);

		// Pace connection starts (but don't wait for connection to complete)
		if (i < connections - 1 && connectionDelay > 0) {
			await sleep(connectionDelay);
		}
	}

	await Promise.all(connectPromises);
	const totalTime = performance.now() - startTime;

	console.log("");
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
		console.log("Errors:");
		for (const [err, count] of errorCounts) {
			console.log(`  ${count}x: ${err}`);
		}
		console.log("");
	}

	// Disconnect all clients
	console.log("[connection-storm] Disconnecting clients...");
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
