import chalk from "chalk";
import { calculatePacingDelay, calculatePacingRate, runWithPacing } from "../utils/pacing.js";
import { createConnectionProgressBar, startProgressBar, stopProgressBar, updateProgressBar } from "../utils/progress.js";
import { sleep } from "../utils/timing.js";
import { type AsyncDeliverySession, setupAsyncDeliverySession, testAsyncRecovery } from "./async-delivery-helpers.js";
import type { AsyncDeliveryOptions, AsyncDeliveryResult } from "./types.js";

/**
 * Async Delivery Scenario
 *
 * Tests historical message recovery after wallet disconnect/reconnect.
 *
 * Flow:
 * 1. Phase 1 (Setup): Create N sessions, complete handshake, disconnect wallet, dApp sends message
 * 2. Phase 2 (Wait): Wait --delay seconds
 * 3. Phase 3 (Recovery): Reconnect wallets, verify they receive the historical message
 */
export async function runAsyncDelivery(options: AsyncDeliveryOptions): Promise<AsyncDeliveryResult> {
	const { target, connections, rampUpSec, delaySec } = options;
	const pacingDelayMs = calculatePacingDelay(connections, rampUpSec);

	console.log(`${chalk.cyan("[async-delivery]")} Creating ${connections} connection pairs to ${target}`);
	console.log(`${chalk.cyan("[async-delivery]")} Peak WebSocket connections: ~${connections * 2} (${connections} dApps + ${connections} wallets during handshake)`);
	console.log(`${chalk.cyan("[async-delivery]")} After setup: ${connections} WebSocket connections (dApps only, wallets disconnected)`);
	console.log(`${chalk.cyan("[async-delivery]")} Delay before wallet reconnect: ${delaySec}s`);
	console.log(`${chalk.cyan("[async-delivery]")} Pacing: ${calculatePacingRate(connections, rampUpSec)} pairs/sec over ${rampUpSec}s`);
	console.log("");

	const startTime = performance.now();

	// Phase 1: Setup sessions
	const sessions: (AsyncDeliverySession | null)[] = [];
	let setupSuccessful = 0;
	let setupFailed = 0;
	let completedCount = 0;

	const setupProgressBar = createConnectionProgressBar("[async-delivery] Phase 1: Setup");
	startProgressBar(setupProgressBar, connections);

	await runWithPacing({
		count: connections,
		rampUpSec,
		onStart: async () => {
			try {
				const session = await setupAsyncDeliverySession(target);
				sessions.push(session);
				completedCount++;
				if (session) {
					setupSuccessful++;
				} else {
					setupFailed++;
				}
			} catch {
				sessions.push(null);
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

	// Phase 2: Wait
	console.log(`${chalk.cyan("[async-delivery]")} Phase 2: Waiting ${delaySec} seconds...`);
	await sleep(delaySec * 1000);
	console.log("");

	// Phase 3: Recovery (paced like setup, with longer timeout for high connection counts)
	const activeSessions = sessions.filter((s): s is AsyncDeliverySession => s !== null);
	let recoverySuccessful = 0;
	let recoveryFailed = 0;
	let recoveryCompleted = 0;
	const recoveryLatencies: number[] = [];

	// Use a longer timeout for recovery - scales with connection count
	const recoveryTimeoutMs = Math.max(60000, activeSessions.length * 20); // At least 60s, or 20ms per connection

	const recoveryProgressBar = createConnectionProgressBar("[async-delivery] Phase 3: Recovery");
	startProgressBar(recoveryProgressBar, activeSessions.length);

	// Use original pacing delay for recovery (not recalculated based on active count)
	const recoveryPromises: Promise<void>[] = [];

	for (let i = 0; i < activeSessions.length; i++) {
		const session = activeSessions[i];
		recoveryPromises.push(
			(async () => {
				try {
					const result = await testAsyncRecovery(session, recoveryTimeoutMs);
					recoveryCompleted++;
					if (result.success && result.recoveryLatencyMs !== undefined) {
						recoverySuccessful++;
						recoveryLatencies.push(result.recoveryLatencyMs);
					} else {
						recoveryFailed++;
					}
				} catch {
					recoveryCompleted++;
					recoveryFailed++;
				}
				updateProgressBar(recoveryProgressBar, recoveryCompleted, {
					immediate: recoverySuccessful,
					recovered: 0,
					failed: recoveryFailed,
				});
			})(),
		);

		// Pace recovery starts (same delay as setup)
		if (i < activeSessions.length - 1 && pacingDelayMs > 0) {
			await sleep(pacingDelayMs);
		}
	}

	await Promise.all(recoveryPromises);
	stopProgressBar(recoveryProgressBar);
	console.log("");

	const totalTime = performance.now() - startTime;

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
			connectionLatencies: [], // Not relevant for this scenario
		},
		retries: {
			totalRetries: 0,
		},
		sessions: {
			attempted: connections,
			successful: setupSuccessful,
			failed: setupFailed,
		},
		messagesSent: {
			attempted: setupSuccessful,
			successful: setupSuccessful,
			failed: 0,
		},
		recovery: {
			attempted: activeSessions.length,
			received: recoverySuccessful,
			failed: recoveryFailed,
			latencies: recoveryLatencies,
		},
		delaySeconds: delaySec,
	};
}
