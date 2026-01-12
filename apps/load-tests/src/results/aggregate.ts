import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import type { TestResults } from "../output/types.js";
import { calculateLatencyStats } from "../utils/stats.js";

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
		latency: {
			min: number;
			max: number;
			avg: number;
			p95: number;
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
		avgLatency: number | null;
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
	const allLatencies: number[] = [];

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

		perDroplet.push({
			file,
			connections: conn.attempted,
			successRate: conn.successRate,
			avgLatency: data.results.latency?.avg ?? null,
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
			latency: calculateLatencyStats(allLatencies),
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
	console.log(chalk.dim("  FILE                   CONNECTIONS   SUCCESS   AVG LATENCY"));
	for (const d of agg.perDroplet) {
		const latencyStr = d.avgLatency !== null ? `${Math.round(d.avgLatency)}ms` : "-";
		const rateColor = d.successRate >= 99 ? chalk.green : d.successRate >= 95 ? chalk.yellow : chalk.red;
		console.log(
			`  ${d.file.padEnd(22)} ${String(d.connections).padEnd(13)} ${rateColor(d.successRate.toFixed(1) + "%").padEnd(9)}   ${latencyStr}`,
		);
	}

	console.log("");
	console.log(chalk.gray("─".repeat(60)));
}

