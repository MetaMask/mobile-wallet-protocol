#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";

const program = new Command();

program
	.name("infra")
	.description("Manage DigitalOcean infrastructure for distributed load testing")
	.version("0.0.1");

program
	.command("create")
	.description("Create DigitalOcean droplets for load testing")
	.action(() => {
		console.log(chalk.yellow("[infra create] Not implemented yet - coming in next PR"));
	});

program
	.command("list")
	.description("List current load test droplets")
	.action(() => {
		console.log(chalk.yellow("[infra list] Not implemented yet - coming in next PR"));
	});

program
	.command("destroy")
	.description("Destroy all load test droplets")
	.action(() => {
		console.log(chalk.yellow("[infra destroy] Not implemented yet - coming in next PR"));
	});

program
	.command("exec")
	.description("Execute a command on all droplets")
	.action(() => {
		console.log(chalk.yellow("[infra exec] Not implemented yet - coming in next PR"));
	});

program
	.command("update")
	.description("Update code on all droplets")
	.action(() => {
		console.log(chalk.yellow("[infra update] Not implemented yet - coming in next PR"));
	});

program
	.command("collect")
	.description("Collect results from all droplets")
	.action(() => {
		console.log(chalk.yellow("[infra collect] Not implemented yet - coming in next PR"));
	});

program.parse();

