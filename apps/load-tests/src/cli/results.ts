#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import {
	aggregateResults,
	printAggregatedResults,
} from "../results/aggregate.js";

const program = new Command();

program
	.name("results")
	.description("Process and aggregate load test results")
	.version("0.0.1");

program
	.command("aggregate")
	.description("Aggregate results from multiple load test runs")
	.requiredOption("--input <dir>", "Directory containing result JSON files")
	.action((options: { input: string }) => {
		try {
			console.log(chalk.cyan(`[results] Aggregating results from ${options.input}...`));
			console.log("");

			const aggregated = aggregateResults(options.input);
			printAggregatedResults(aggregated);
		} catch (error) {
			console.error(chalk.red(`[results] Error: ${(error as Error).message}`));
			process.exit(1);
		}
	});

program.parse();
