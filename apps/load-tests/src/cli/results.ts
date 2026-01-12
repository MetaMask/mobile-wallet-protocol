#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";

const program = new Command();

program
	.name("results")
	.description("Process and aggregate load test results")
	.version("0.0.1");

program
	.command("aggregate")
	.description("Aggregate results from multiple load test runs")
	.action(() => {
		console.log(chalk.yellow("[results aggregate] Not implemented yet - coming in next PR"));
	});

program.parse();

