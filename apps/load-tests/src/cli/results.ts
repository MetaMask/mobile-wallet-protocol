#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
	.name("results:aggregate")
	.description("Aggregate results from multiple load test runs")
	.version("0.0.1")
	.requiredOption("--input <dir>", "Directory containing result JSON files")
	.action((options) => {
		console.log("[results] Aggregate results");
		console.log(`  Input: ${options.input}`);
		// TODO: Implement results aggregation
	});

program.parse();

