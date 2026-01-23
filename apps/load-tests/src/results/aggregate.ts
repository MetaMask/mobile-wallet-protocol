import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import type { TestResults } from "../output/types.js";
import type { ScenarioResult } from "../scenarios/types.js";
import { calculateConnectTimeStats } from "../utils/stats.js";

/**
 * Aggregated results from multiple load test runs.
 */
export interface AggregatedResults {
	dropletCount: number;
	files: string[];
	scenario: string;
	target: string;
	totals: {
		connections: {
			attempted: number;
			successful: number;
			failed: number;
			successRate: number;
			immediate: number;
			recovered: number;
		};
		timing: {
			totalTimeMs: number;
			avgTimeMs: number;
			connectionsPerSec: number;
		};
		connectTime: {
			min: number;
			max: number;
			avg: number;
			p50: number;
			p95: number;
			p99: number;
		} | null;
		retries: {
			totalRetries: number;
			avgRetriesPerConnection: number;
		};
	};
	perDroplet: Array<{
		file: string;
		connections: number;
		successRate: number;
		avgConnectTime: number | null;
	}>;
}

/**
 * Load and aggregate results from a directory of JSON files.
 */
export function aggregateResults(inputDir: string): AggregatedResults {
	// Find all JSON files in the directory
	if (!fs.existsSync(inputDir)) {
		throw new Error(`Directory not found: ${inputDir}`);
	}

	const files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".json"));
	if (files.length === 0) {
		throw new Error(`No JSON files found in: ${inputDir}`);
	}

	// Load all results
	const results: Array<{ file: string; data: TestResults }> = [];
	for (const file of files) {
		const filePath = path.join(inputDir, file);
		const content = fs.readFileSync(filePath, "utf-8");
		try {
			const data = JSON.parse(content) as TestResults;
			// Validate that the parsed data has the expected structure
			if (!data.scenario || !data.target || !data.results?.connections) {
				console.warn(chalk.yellow(`Warning: ${file} is missing required fields, skipping`));
				continue;
			}
			results.push({ file, data });
		} catch {
			console.warn(chalk.yellow(`Warning: Could not parse ${file}, skipping`));
		}
	}

	if (results.length === 0) {
		throw new Error("No valid result files found");
	}

	// Aggregate totals
	let totalAttempted = 0;
	let totalSuccessful = 0;
	let totalFailed = 0;
	let totalImmediate = 0;
	let totalRecovered = 0;
	let totalTimeMs = 0;
	let totalRetries = 0;
	const allConnectTimes: number[] = [];

	const perDroplet: AggregatedResults["perDroplet"] = [];

	for (const { file, data } of results) {
		const conn = data.results.connections;
		totalAttempted += conn.attempted;
		totalSuccessful += conn.successful;
		totalFailed += conn.failed;
		totalImmediate += conn.immediate;
		totalRecovered += conn.recovered;
		totalTimeMs += data.results.timing.totalTimeMs;
		totalRetries += data.results.retries.totalRetries;

		// Collect individual connect times for aggregate stats
		// We use the per-droplet average * count as an approximation
		// since individual times aren't stored in TestResults
		if (data.results.connectTime) {
			// Push multiple samples based on connection count to weight the average
			const times = data.results.connectTime;
			allConnectTimes.push(times.min, times.avg, times.max);
		}

		perDroplet.push({
			file,
			connections: conn.attempted,
			successRate: conn.successRate,
			avgConnectTime: data.results.connectTime?.avg ?? null,
		});
	}

	// Use the first result for scenario/target info
	const first = results[0].data;

	return {
		dropletCount: results.length,
		files: files,
		scenario: first.scenario,
		target: first.target,
		totals: {
			connections: {
				attempted: totalAttempted,
				successful: totalSuccessful,
				failed: totalFailed,
				successRate: totalAttempted > 0 ? (totalSuccessful / totalAttempted) * 100 : 0,
				immediate: totalImmediate,
				recovered: totalRecovered,
			},
			timing: {
				totalTimeMs,
				avgTimeMs: totalTimeMs / results.length,
				connectionsPerSec: totalTimeMs > 0 ? (totalAttempted / (totalTimeMs / 1000)) * results.length : 0,
			},
			connectTime: calculateConnectTimeStats(allConnectTimes),
			retries: {
				totalRetries,
				avgRetriesPerConnection: totalAttempted > 0 ? totalRetries / totalAttempted : 0,
			},
		},
		perDroplet,
	};
}

/**
 * Print aggregated results.
 */
export function printAggregatedResults(agg: AggregatedResults): void {
	console.log(chalk.gray("─".repeat(60)));
	console.log(chalk.bold.cyan("               DISTRIBUTED TEST SUMMARY"));
	console.log(chalk.gray("─".repeat(60)));
	console.log("");

	console.log(chalk.bold("Overview:"));
	console.log(`  Droplets:          ${chalk.cyan(agg.dropletCount)}`);
	console.log(`  Scenario:          ${agg.scenario}`);
	console.log(`  Target:            ${chalk.dim(agg.target)}`);
	console.log("");

	console.log(chalk.bold("Connections:"));
	const successRate = agg.totals.connections.successRate;
	const rateColor = successRate >= 99 ? chalk.green : successRate >= 95 ? chalk.yellow : chalk.red;
	console.log(`  Total:             ${chalk.cyan(agg.totals.connections.attempted)}`);
	console.log(`  Successful:        ${chalk.green(agg.totals.connections.successful)} (${rateColor(successRate.toFixed(1) + "%")})`);
	console.log(`  Failed:            ${agg.totals.connections.failed > 0 ? chalk.red(agg.totals.connections.failed) : chalk.green("0")}`);
	console.log(`  Immediate:         ${agg.totals.connections.immediate}`);
	console.log(`  Recovered:         ${agg.totals.connections.recovered}`);
	console.log("");

	console.log(chalk.bold("Timing:"));
	console.log(`  Avg Duration:      ${Math.round(agg.totals.timing.avgTimeMs)}ms`);
	console.log(`  Throughput:        ${agg.totals.timing.connectionsPerSec.toFixed(1)} conn/sec (combined)`);
	console.log("");

	if (agg.totals.retries.totalRetries > 0) {
		console.log(chalk.bold("Retries:"));
		console.log(chalk.yellow(`  Total:             ${agg.totals.retries.totalRetries}`));
		console.log(chalk.yellow(`  Avg per Conn:      ${agg.totals.retries.avgRetriesPerConnection.toFixed(2)}`));
		console.log("");
	}

	console.log(chalk.bold("Per Droplet:"));
	console.log(chalk.dim("  FILE                   CONNECTIONS   SUCCESS   AVG CONNECT"));
	for (const d of agg.perDroplet) {
		const connectTimeStr = d.avgConnectTime !== null ? `${Math.round(d.avgConnectTime)}ms` : "-";
		const rateColor = d.successRate >= 99 ? chalk.green : d.successRate >= 95 ? chalk.yellow : chalk.red;
		console.log(
			`  ${d.file.padEnd(22)} ${String(d.connections).padEnd(13)} ${rateColor(d.successRate.toFixed(1) + "%").padEnd(9)}   ${connectTimeStr}`,
		);
	}

	console.log("");
	console.log(chalk.gray("─".repeat(60)));
}

/**
 * Aggregated scenario result from multiple workers.
 * This combines raw ScenarioResult objects in memory (not from files).
 */
export interface AggregatedScenarioResult {
	/** Number of workers that contributed to this result */
	workerCount: number;
	/** Combined result */
	result: ScenarioResult;
	/** Per-worker breakdown for debugging */
	perWorker: Array<{
		workerId: number;
		connections: number;
		successful: number;
		failed: number;
	}>;
}

/**
 * Aggregate ScenarioResult objects from multiple workers in memory.
 * This is used by the coordinator to combine results from forked workers.
 */
export function aggregateScenarioResults(
	results: Array<{ workerId: number; result: ScenarioResult }>,
): AggregatedScenarioResult {
	if (results.length === 0) {
		throw new Error("No results to aggregate");
	}

	// Initialize aggregated values
	let totalAttempted = 0;
	let totalSuccessful = 0;
	let totalFailed = 0;
	let totalImmediate = 0;
	let totalRecovered = 0;
	let maxTimeMs = 0; // Use max time since workers run in parallel
	let totalRetries = 0;
	const allLatencies: number[] = [];

	// Steady-state specific
	let totalCurrentDisconnects = 0;
	let maxPeakDisconnects = 0;
	let totalReconnects = 0;
	let hassteadyState = false;
	let totalRampUpTimeMs = 0;
	let totalHoldDurationMs = 0;

	const perWorker: AggregatedScenarioResult["perWorker"] = [];

	for (const { workerId, result } of results) {
		const conn = result.connections;

		totalAttempted += conn.attempted;
		totalSuccessful += conn.successful;
		totalFailed += conn.failed;
		totalImmediate += conn.immediate;
		totalRecovered += conn.recovered;

		// Use max time since workers run in parallel
		maxTimeMs = Math.max(maxTimeMs, result.timing.totalTimeMs);

		totalRetries += result.retries.totalRetries;

		// Collect all latencies for combined percentile calculation
		allLatencies.push(...result.timing.connectionLatencies);

		// Handle steady-state specific fields
		if (result.steadyState) {
			hassteadyState = true;
			totalCurrentDisconnects += result.steadyState.currentDisconnects;
			maxPeakDisconnects = Math.max(maxPeakDisconnects, result.steadyState.peakDisconnects);
			totalReconnects += result.steadyState.reconnectsDuringHold;
			totalRampUpTimeMs = Math.max(totalRampUpTimeMs, result.steadyState.rampUpTimeMs);
			totalHoldDurationMs = Math.max(totalHoldDurationMs, result.steadyState.holdDurationMs);
		}

		perWorker.push({
			workerId,
			connections: conn.attempted,
			successful: conn.successful,
			failed: conn.failed,
		});
	}

	// Calculate combined stability
	const connectionStability =
		totalSuccessful > 0
			? ((totalSuccessful - totalCurrentDisconnects) / totalSuccessful) * 100
			: 0;

	// Build aggregated result
	const aggregatedResult: ScenarioResult = {
		connections: {
			attempted: totalAttempted,
			successful: totalSuccessful,
			failed: totalFailed,
			immediate: totalImmediate,
			recovered: totalRecovered,
		},
		timing: {
			totalTimeMs: maxTimeMs,
			connectionLatencies: allLatencies,
		},
		retries: {
			totalRetries,
		},
	};

	// Add steady-state fields if present
	if (hassteadyState) {
		aggregatedResult.steadyState = {
			rampUpTimeMs: totalRampUpTimeMs,
			holdDurationMs: totalHoldDurationMs,
			currentDisconnects: totalCurrentDisconnects,
			peakDisconnects: maxPeakDisconnects,
			reconnectsDuringHold: totalReconnects,
			connectionStability,
		};
	}

	return {
		workerCount: results.length,
		result: aggregatedResult,
		perWorker,
	};
}

/**
 * Print a summary of worker results.
 */
export function printWorkerSummary(agg: AggregatedScenarioResult): void {
	console.log("");
	console.log(chalk.bold.cyan("Worker Summary:"));
	console.log(chalk.dim("  WORKER   CONNECTIONS   SUCCESSFUL   FAILED"));
	for (const w of agg.perWorker) {
		const failedColor = w.failed > 0 ? chalk.red : chalk.green;
		console.log(
			`  ${String(w.workerId).padEnd(8)} ${String(w.connections).padEnd(13)} ${chalk.green(String(w.successful).padEnd(12))} ${failedColor(w.failed)}`,
		);
	}
	console.log(chalk.dim(`  ${"─".repeat(45)}`));
	console.log(
		`  ${"Total".padEnd(8)} ${chalk.cyan(String(agg.result.connections.attempted).padEnd(13))} ${chalk.green(String(agg.result.connections.successful).padEnd(12))} ${agg.result.connections.failed > 0 ? chalk.red(agg.result.connections.failed) : chalk.green(0)}`,
	);
	console.log("");
}
