#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
	.name("results")
	.description("Process and aggregate load test results")
	.version("0.0.1");

program
	.command("aggregate")
	.description("Aggregate results from multiple load test runs")
	.requiredOption("--input <dir>", "Directory containing result JSON files")
	.action((options) => {
		console.log("[results] Aggregate results");
		console.log(`  Input: ${options.input}`);
		// TODO: Implement results aggregation
	});

program.parse();
