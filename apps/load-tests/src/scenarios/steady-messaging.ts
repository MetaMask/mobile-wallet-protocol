import chalk from "chalk";
import { createSessionPair, type SessionPair } from "../client/session-pair.js";
import { calculatePacingDelay, calculatePacingRate } from "../utils/pacing.js";
import { createConnectionProgressBar, startProgressBar, stopProgressBar, updateProgressBar } from "../utils/progress.js";
import { sleep } from "../utils/timing.js";
import type { SteadyMessagingOptions, SteadyMessagingResult } from "./types.js";

/**
 * Steady Messaging Scenario
 *
 * Tests sustained message latency under load with realistic timing.
 *
 * KEY DESIGN: Each pair runs its own independent messaging loop, started immediately
 * upon connection. This naturally spreads out the load - no synchronized bursts.
 *
 * Flow per pair:
 *   1. Connect (during ramp-up)
 *   2. Immediately start messaging loop:
 *      - dApp sends request
 *      - Wallet waits (simulates user reviewing request)
 *      - Wallet responds
 *      - dApp waits (simulates user reviewing result)
 *      - Repeat until test ends
 *   3. Disconnect
 *
 * Since pairs connect at staggered times during ramp-up and each cycle takes
 * 2 * messageInterval, the load is naturally distributed across time.
 */
export async function runSteadyMessaging(options: SteadyMessagingOptions): Promise<SteadyMessagingResult> {
	const { target, connections, durationSec, rampUpSec, messageIntervalSec } = options;
	const delayMs = messageIntervalSec * 1000;

	console.log(`${chalk.cyan("[steady-messaging]")} Creating ${connections} connection pairs to ${target}`);
	console.log(`${chalk.cyan("[steady-messaging]")} Duration: ${durationSec}s after ramp-up completes`);
	console.log(`${chalk.cyan("[steady-messaging]")} Message cycle: dApp sends → (${messageIntervalSec}s) → Wallet responds → (${messageIntervalSec}s) → repeat`);
	console.log(`${chalk.cyan("[steady-messaging]")} Pacing: ${calculatePacingRate(connections, rampUpSec)} pairs/sec over ${rampUpSec}s`);
	console.log(`${chalk.cyan("[steady-messaging]")} Each pair starts messaging immediately upon connecting (no burst)`);
	console.log("");

	const startTime = performance.now();

	// Shared state for collecting metrics (thread-safe via single-threaded JS)
	const allLatencies: number[] = [];
	const latencySnapshots: SteadyMessagingResult["latencyOverTime"] = [];
	let totalExchanges = 0;
	let successfulExchanges = 0;
	let failedExchanges = 0;
	let disconnects = 0;
	let setupSuccessful = 0;
	let setupFailed = 0;
	let completedCount = 0;

	// Track active pairs and their messaging loops
	const activePairs = new Set<SessionPair>();
	const messagingLoops: Promise<void>[] = [];

	// Calculate test end time (ramp-up + duration)
	const testEndTime = startTime + (rampUpSec * 1000) + (durationSec * 1000);

	// Progress tracking
	const setupProgressBar = createConnectionProgressBar("[steady-messaging] Ramp-up + Messaging");
	startProgressBar(setupProgressBar, connections);

	// Logging state
	let lastLogTime = startTime;
	const logIntervalMs = 30000;
	let lastSnapshotTime = startTime;
	const snapshotIntervalMs = 10000; // Snapshot latencies every 10s

	/**
	 * Messaging loop for a single pair. Runs until test ends.
	 */
	async function runMessagingLoop(pair: SessionPair): Promise<void> {
		let messageId = 0;

		while (performance.now() < testEndTime) {
			messageId++;

			try {
				// Exchange with response delay (wallet waits before responding)
				const result = await pair.exchangeMessage({
					messageId,
					responseDelayMs: delayMs,
				});

				totalExchanges++;

				if (result.success) {
					successfulExchanges++;
					allLatencies.push(result.latencyMs);
				} else {
					failedExchanges++;
					if (result.error?.includes("not connected")) {
						activePairs.delete(pair);
						disconnects++;
						return; // Exit loop - connection dead
					}
				}
			} catch {
				totalExchanges++;
				failedExchanges++;
				activePairs.delete(pair);
				disconnects++;
				return; // Exit loop - connection dead
			}

			// dApp user waits before sending next request
			await sleep(delayMs);
		}
	}

	/**
	 * Periodically log progress and take latency snapshots.
	 */
	async function monitorProgress(): Promise<void> {
		while (performance.now() < testEndTime) {
			const now = performance.now();

			// Log progress every 30 seconds
			if (now - lastLogTime >= logIntervalMs) {
				const elapsed = Math.round((now - startTime) / 1000);
				const remaining = Math.round(Math.max(0, testEndTime - now) / 1000);
				const recentLatencies = allLatencies.slice(-1000);
				const p99 = recentLatencies.length > 0
					? recentLatencies.sort((a, b) => a - b)[Math.floor(recentLatencies.length * 0.99)] ?? 0
					: 0;

				console.log(
					`${chalk.cyan("[steady-messaging]")} ${elapsed}s elapsed, ${remaining}s remaining | ` +
					`Active: ${activePairs.size}/${setupSuccessful} | ` +
					`Exchanges: ${successfulExchanges}/${totalExchanges} | ` +
					`Recent P99: ${p99.toFixed(0)}ms`,
				);
				lastLogTime = now;
			}

			// Take latency snapshots every 10 seconds
			if (now - lastSnapshotTime >= snapshotIntervalMs && allLatencies.length > 0) {
				const recentLatencies = allLatencies.slice(-1000);
				if (recentLatencies.length > 0) {
					const sorted = [...recentLatencies].sort((a, b) => a - b);
					latencySnapshots.push({
						timestampMs: Math.round(now - startTime),
						p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
						p99: sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1] ?? 0,
						exchanges: recentLatencies.length,
					});
				}
				lastSnapshotTime = now;
			}

			await sleep(1000);
		}
	}

	// Start progress monitor
	const monitorPromise = monitorProgress();

	// Ramp up pairs and start messaging immediately upon connection
	const pacingDelay = calculatePacingDelay(connections, rampUpSec);

	console.log(`${chalk.cyan("[steady-messaging]")} Starting ramp-up with immediate messaging...`);

	for (let i = 0; i < connections; i++) {
		// Start connection (fire-and-forget, don't await)
		const connectionPromise = (async () => {
			try {
				const result = await createSessionPair({ url: target });
				completedCount++;

				if (result.success && result.pair) {
					setupSuccessful++;
					activePairs.add(result.pair);

					// Immediately start messaging loop for this pair
					const loopPromise = runMessagingLoop(result.pair);
					messagingLoops.push(loopPromise);
				} else {
					setupFailed++;
				}
			} catch {
				completedCount++;
				setupFailed++;
			}

			updateProgressBar(setupProgressBar, completedCount, {
				immediate: setupSuccessful,
				recovered: 0,
				failed: setupFailed,
			});
		})();

		messagingLoops.push(connectionPromise);

		// Pace the connection starts
		if (i < connections - 1 && pacingDelay > 0) {
			await sleep(pacingDelay);
		}
	}

	// Wait for all messaging loops to complete (they run until testEndTime)
	await Promise.all(messagingLoops);
	await monitorPromise;

	stopProgressBar(setupProgressBar);
	console.log("");

	// === Disconnect all ===
	console.log(`${chalk.cyan("[steady-messaging]")} Disconnecting ${activePairs.size} pairs...`);

	const disconnectPromises = Array.from(activePairs).map(async (pair) => {
		try {
			await pair.disconnect();
		} catch {
			// Ignore disconnect errors
		}
	});

	await Promise.all(disconnectPromises);

	const totalTime = performance.now() - startTime;

	console.log(`${chalk.cyan("[steady-messaging]")} Done`);
	console.log("");

	return {
		connections: {
			attempted: connections,
			successful: setupSuccessful,
			failed: setupFailed,
			immediate: setupSuccessful,
			recovered: 0,
		},
		timing: {
			totalTimeMs: totalTime,
			connectionLatencies: [],
		},
		retries: {
			totalRetries: 0,
		},
		sessions: {
			attempted: connections,
			successful: setupSuccessful,
			failed: setupFailed,
		},
		messaging: {
			totalExchanges,
			successful: successfulExchanges,
			failed: failedExchanges,
			latencies: allLatencies,
		},
		stability: {
			disconnects,
		},
		latencyOverTime: latencySnapshots,
		durationSeconds: durationSec,
		messageIntervalSeconds: messageIntervalSec,
	};
}
