import chalk from "chalk";
import {
	createSessionPair,
	type SessionPair,
	type SessionPairResult,
} from "../client/session-pair.js";
import { calculatePacingRate, runWithPacing } from "../utils/pacing.js";
import {
	createConnectionProgressBar,
	startProgressBar,
	stopProgressBar,
	updateProgressBar,
} from "../utils/progress.js";
import { sleep } from "../utils/timing.js";
import type { RealisticSessionOptions, RealisticSessionResult } from "./types.js";

/**
 * Realistic session scenario:
 *
 * Creates N dApp+Wallet session pairs using the full protocol handshake,
 * exchanges messages between each pair, and measures both handshake time
 * and message round-trip latency.
 *
 * HIGH-FIDELITY FROM BACKEND PERSPECTIVE:
 * - Uses actual DappClient and WalletClient from the protocol libraries
 * - Messages flow through the same channels as production
 * - Handshake follows the trusted mode protocol
 * - Wallet connects after a realistic delay (simulates QR scan time)
 *
 * LIGHTWEIGHT FROM RUNNER PERSPECTIVE:
 * - Uses MockKeyManager (no real crypto operations)
 * - Fixed message templates (no payload generation)
 * - Crypto operations are ~100x faster than real ECIES
 *
 * TIMING:
 * - Wallet connect delay: 5 seconds (simulates user scanning QR)
 * - Message delay: 10 seconds between messages (simulates user interaction)
 *
 * FLOW FOR EACH SESSION:
 * 1. Create dApp client, initiate connection, emit session_request
 * 2. Wait 5 seconds (QR scan time - session_request sits in history)
 * 3. Create Wallet client, connect (retrieves session_request from history)
 * 4. Handshake completes
 * 5. Exchange --messages-per-session request/response pairs (with 10s delays)
 * 6. Hold connection for remaining --duration time
 * 7. Gracefully disconnect all sessions
 *
 * PACING:
 * Session pairs are STARTED at a rate determined by --ramp-up.
 * For example, 1000 pairs over 60s = ~17 pair starts/second.
 * Each pair runs independently (parallel execution).
 *
 * With a 5s wallet delay + ~2s handshake + 3 messages * 10s = ~37s per session:
 * - Session #1 starts at t=0, messages complete ~t=37s, then HOLDS
 * - Session #1000 starts at t=60s, messages complete ~t=97s, then HOLDS
 * - All sessions remain connected after message exchange
 */
export async function runRealisticSession(
	options: RealisticSessionOptions,
): Promise<RealisticSessionResult> {
	const { target, connections, rampUpSec, messagesPerSession } = options;

	console.log(
		`${chalk.cyan("[realistic-session]")} Creating ${chalk.bold(connections)} connection pairs to ${chalk.dim(target)}`,
	);
	console.log(
		`${chalk.cyan("[realistic-session]")} Messages per pair: ${chalk.bold(messagesPerSession)}`,
	);
	console.log(
		`${chalk.cyan("[realistic-session]")} Timing: 5s wallet delay, 10s between messages`,
	);
	if (rampUpSec > 0) {
		console.log(
			`${chalk.cyan("[realistic-session]")} Pacing: ${chalk.bold(calculatePacingRate(connections, rampUpSec))} pairs/sec over ${rampUpSec}s`,
		);
	}
	console.log("");

	const startTime = performance.now();

	// Track results
	const sessionResults: SessionPairResult[] = [];
	const activePairs: SessionPair[] = [];
	const handshakeLatencies: number[] = [];
	const messageLatencies: number[] = [];
	let messagesSent = 0;
	let messagesReceived = 0;
	let messagesFailed = 0;

	// Progress tracking
	let successfulSessions = 0;
	let failedSessions = 0;

	// Create progress bar
	const progressBar = createConnectionProgressBar("[realistic-session]");
	startProgressBar(progressBar, connections);

	// Run with pacing
	await runWithPacing({
		count: connections,
		rampUpSec,
		onStart: async () => {
			try {
				// Create session pair (includes wallet connect delay and handshake)
				const result = await createSessionPair({
					url: target,
					handshakeTimeoutMs: 120000, // 2 min timeout (includes 5s wallet delay)
				});

				sessionResults.push(result);

				if (result.success && result.pair) {
					successfulSessions++;
					handshakeLatencies.push(result.handshakeTimeMs);
					activePairs.push(result.pair);

					// Exchange messages (includes delays)
					for (let m = 0; m < messagesPerSession; m++) {
						messagesSent++;
						// Message ID starts at 1 for human-readability
						const exchangeResult = await result.pair.exchangeMessage(m + 1);

						if (exchangeResult.success) {
							messagesReceived++;
							messageLatencies.push(exchangeResult.latencyMs);
						} else {
							messagesFailed++;
						}
					}
				} else {
					failedSessions++;
				}
			} catch {
				// Handle any unexpected errors gracefully
				failedSessions++;
				sessionResults.push({
					success: false,
					handshakeTimeMs: 0,
					error: "Unexpected error during session",
				});
			}

			// Update progress bar
			updateProgressBar(progressBar, sessionResults.length, {
				immediate: successfulSessions,
				recovered: 0,
				failed: failedSessions,
			});
		},
	});

	stopProgressBar(progressBar);

	const totalTime = performance.now() - startTime;

	console.log("");

	// Print errors if any
	const failed = sessionResults.filter((r) => !r.success);
	if (failed.length > 0) {
		const errorCounts = new Map<string, number>();
		for (const f of failed) {
			const err = f.error ?? "Unknown error";
			errorCounts.set(err, (errorCounts.get(err) ?? 0) + 1);
		}
		console.log(chalk.red("Session Errors:"));
		for (const [err, count] of errorCounts) {
			console.log(chalk.red(`  ${count}x: ${err}`));
		}
		console.log("");
	}

	// Hold connections for the remaining duration
	const elapsedSec = totalTime / 1000;
	const holdDurationSec = Math.max(0, options.durationSec - elapsedSec);
	
	if (holdDurationSec > 0) {
		console.log(`${chalk.cyan("[realistic-session]")} Holding ${activePairs.length} connections for ${Math.round(holdDurationSec)}s...`);
		
		// Log progress every 30 seconds during hold
		const holdStartTime = performance.now();
		const logInterval = 30000; // 30 seconds
		let nextLogTime = logInterval;
		
		while (performance.now() - holdStartTime < holdDurationSec * 1000) {
			await sleep(1000);
			const elapsed = performance.now() - holdStartTime;
			if (elapsed >= nextLogTime) {
				const remaining = Math.round((holdDurationSec * 1000 - elapsed) / 1000);
				console.log(`${chalk.cyan("[realistic-session]")} [${Math.round(elapsed / 1000)}s] Holding ${activePairs.length} connections... ${remaining}s remaining`);
				nextLogTime += logInterval;
			}
		}
		
		console.log(`${chalk.cyan("[realistic-session]")} Hold complete.`);
	} else {
		console.log(`${chalk.cyan("[realistic-session]")} All sessions established with ${activePairs.length} connections.`);
	}

	// Gracefully disconnect all pairs
	const { rampDownSec } = options;
	if (rampDownSec > 0 && activePairs.length > 0) {
		// Paced disconnects - spread over rampDownSec
		console.log(`${chalk.cyan("[realistic-session]")} Disconnecting ${activePairs.length} sessions over ${rampDownSec}s...`);
		await runWithPacing({
			count: activePairs.length,
			rampUpSec: rampDownSec,
			onStart: async (index) => {
				try {
					await activePairs[index].disconnect();
				} catch {
					// Ignore disconnect errors - connection may already be closed
				}
			},
		});
	} else {
		// Instant disconnects (original behavior)
		console.log(`${chalk.cyan("[realistic-session]")} Disconnecting ${activePairs.length} sessions...`);
		const disconnectPromises = activePairs.map(async (pair) => {
			try {
				await pair.disconnect();
			} catch {
				// Ignore disconnect errors - connection may already be closed
			}
		});
		await Promise.all(disconnectPromises);
	}
	console.log(`${chalk.cyan("[realistic-session]")} All sessions disconnected.`);

	const finalTime = performance.now() - startTime;

	return {
		connections: {
			attempted: connections,
			successful: successfulSessions,
			failed: failedSessions,
			// For compatibility with existing result structure
			immediate: successfulSessions,
			recovered: 0,
		},
		timing: {
			totalTimeMs: finalTime,
			connectionLatencies: [], // Not used for this scenario
		},
		retries: {
			totalRetries: 0, // Not tracked for high-fidelity scenario
		},
		// High-fidelity specific metrics
		handshake: {
			attempted: connections,
			successful: successfulSessions,
			failed: failedSessions,
			latencies: handshakeLatencies,
		},
		messages: {
			sent: messagesSent,
			received: messagesReceived,
			failed: messagesFailed,
			latencies: messageLatencies,
		},
	};
}
