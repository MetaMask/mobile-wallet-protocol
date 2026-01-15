import chalk from "chalk";
import { createSessionPair, type SessionPair } from "../client/session-pair.js";
import { calculatePacingRate, runWithPacing } from "../utils/pacing.js";
import { createConnectionProgressBar, startProgressBar, stopProgressBar, updateProgressBar } from "../utils/progress.js";
import { sleep } from "../utils/timing.js";
import type { SteadyMessagingOptions, SteadyMessagingResult } from "./types.js";

/**
 * Steady Messaging Scenario
 *
 * Tests sustained message latency under load over time.
 *
 * Flow:
 * 1. Ramp up: Create N dApp+Wallet pairs (paced)
 * 2. Hold phase: Exchange messages every --message-interval seconds for --duration
 * 3. Disconnect all and report metrics
 */
export async function runSteadyMessaging(options: SteadyMessagingOptions): Promise<SteadyMessagingResult> {
	const { target, connections, durationSec, rampUpSec, messageIntervalSec } = options;

	console.log(`${chalk.cyan("[steady-messaging]")} Creating ${connections} connection pairs to ${target}`);
	console.log(`${chalk.cyan("[steady-messaging]")} Duration: ${durationSec}s, Message interval: ${messageIntervalSec}s`);
	console.log(`${chalk.cyan("[steady-messaging]")} Pacing: ${calculatePacingRate(connections, rampUpSec)} pairs/sec over ${rampUpSec}s`);
	console.log("");

	const startTime = performance.now();

	// === Phase 1: Ramp up - create all session pairs ===
	const pairs: SessionPair[] = [];
	let setupSuccessful = 0;
	let setupFailed = 0;
	let completedCount = 0;

	const setupProgressBar = createConnectionProgressBar("[steady-messaging] Phase 1: Setup");
	startProgressBar(setupProgressBar, connections);

	await runWithPacing({
		count: connections,
		rampUpSec,
		onStart: async () => {
			try {
				const result = await createSessionPair({ url: target });
				completedCount++;
				if (result.success && result.pair) {
					pairs.push(result.pair);
					setupSuccessful++;
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
		},
	});

	stopProgressBar(setupProgressBar);
	console.log("");
	console.log(`${chalk.cyan("[steady-messaging]")} Setup complete: ${pairs.length} pairs connected`);
	console.log("");

	// === Phase 2: Hold phase - exchange messages periodically ===
	const allLatencies: number[] = [];
	const latencyOverTime: SteadyMessagingResult["latencyOverTime"] = [];
	let totalExchanges = 0;
	let successfulExchanges = 0;
	let failedExchanges = 0;
	let disconnects = 0;
	let messageId = 0;

	const holdStartTime = performance.now();
	const holdEndTime = holdStartTime + durationSec * 1000;
	const intervalMs = messageIntervalSec * 1000;
	let nextExchangeTime = holdStartTime + intervalMs;
	let lastLogTime = holdStartTime;
	const logIntervalMs = 30000; // Log progress every 30 seconds

	// Track which pairs are still alive
	const activePairs = new Set(pairs);

	console.log(`${chalk.cyan("[steady-messaging]")} Phase 2: Hold for ${durationSec}s (messaging every ${messageIntervalSec}s)`);

	while (performance.now() < holdEndTime) {
		const now = performance.now();

		// Time for a message exchange round?
		if (now >= nextExchangeTime) {
			const roundLatencies: number[] = [];

			// Exchange messages with all active pairs in parallel
			const exchangePromises = Array.from(activePairs).map(async (pair) => {
				messageId++;
				try {
					const result = await pair.exchangeMessage(messageId);
					if (result.success) {
						roundLatencies.push(result.latencyMs);
						successfulExchanges++;
					} else {
						failedExchanges++;
						// If the exchange failed, the connection might be dead
						if (result.error?.includes("not connected")) {
							activePairs.delete(pair);
							disconnects++;
						}
					}
				} catch {
					failedExchanges++;
					activePairs.delete(pair);
					disconnects++;
				}
				totalExchanges++;
			});

			await Promise.all(exchangePromises);

			// Record this round's latencies
			allLatencies.push(...roundLatencies);

			// Record time-series data
			if (roundLatencies.length > 0) {
				const sorted = [...roundLatencies].sort((a, b) => a - b);
				latencyOverTime.push({
					timestampMs: Math.round(now - holdStartTime),
					p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
					p99: sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1] ?? 0,
					exchanges: roundLatencies.length,
				});
			}

			nextExchangeTime = now + intervalMs;
		}

		// Log progress every 30 seconds
		if (now - lastLogTime >= logIntervalMs) {
			const elapsed = Math.round((now - holdStartTime) / 1000);
			const remaining = Math.round((holdEndTime - now) / 1000);
			const latestP99 = latencyOverTime[latencyOverTime.length - 1]?.p99 ?? 0;
			console.log(
				`${chalk.cyan("[steady-messaging]")}   ${elapsed}s elapsed, ${remaining}s remaining | ` +
				`Active: ${activePairs.size}/${pairs.length} | ` +
				`Exchanges: ${successfulExchanges}/${totalExchanges} | ` +
				`P99: ${latestP99.toFixed(0)}ms`,
			);
			lastLogTime = now;
		}

		// Short sleep to avoid busy-waiting
		await sleep(100);
	}

	console.log("");

	// === Phase 3: Disconnect all ===
	console.log(`${chalk.cyan("[steady-messaging]")} Phase 3: Disconnecting...`);

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
		latencyOverTime,
		durationSeconds: durationSec,
		messageIntervalSeconds: messageIntervalSec,
	};
}
