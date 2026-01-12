#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import { collectFromDroplets, printCollectResults } from "../infra/collect.js";
import { loadInfraConfig } from "../infra/config.js";
import { createDroplet, deleteDroplet, listDropletsByPrefix, waitForDropletActive } from "../infra/digitalocean.js";
import { type DropletSetupStatus, formatStatus, setupDroplet } from "../infra/droplet.js";
import { execOnDroplets, printExecResults, saveExecLogs } from "../infra/exec.js";
import { DROPLET_HOURLY_COST, DROPLET_IMAGE, DROPLET_REGION, DROPLET_SIZE, type DropletInfo } from "../infra/types.js";

const program = new Command();

program.name("infra").description("Manage DigitalOcean infrastructure for distributed load testing").version("0.0.1");

/**
 * Format a relative time string (e.g., "2h ago")
 */
function formatRelativeTime(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays > 0) return `${diffDays}d ago`;
	if (diffHours > 0) return `${diffHours}h ago`;
	if (diffMins > 0) return `${diffMins}m ago`;
	return "just now";
}

/**
 * Print a table of droplets.
 */
function printDropletTable(droplets: DropletInfo[]): void {
	// Header
	console.log(chalk.dim("  NAME           IP               REGION   SIZE           STATUS   CREATED"));

	for (const d of droplets) {
		const statusColor = d.status === "active" ? chalk.green : chalk.yellow;
		console.log(
			`  ${d.name.padEnd(14)} ${(d.ip ?? "pending").padEnd(16)} ${d.region.padEnd(8)} ${d.size.padEnd(14)} ${statusColor(d.status.padEnd(8))} ${formatRelativeTime(d.createdAt)}`,
		);
	}
}

// ============================================================================
// LIST COMMAND
// ============================================================================

program
	.command("list")
	.description("List current load test droplets")
	.option("--name-prefix <prefix>", "Prefix to filter droplets", "load-test")
	.action(async (options: { namePrefix: string }) => {
		try {
			const config = loadInfraConfig();
			const droplets = await listDropletsByPrefix(config.digitalOceanToken, options.namePrefix);

			if (droplets.length === 0) {
				console.log(chalk.yellow(`[infra list] No droplets found matching prefix "${options.namePrefix}"`));
				return;
			}

			console.log(chalk.cyan(`[infra list] Found ${droplets.length} droplet(s):`));
			console.log("");
			printDropletTable(droplets);

			// Calculate hourly cost
			const hourlyCost = droplets.length * DROPLET_HOURLY_COST;
			console.log("");
			console.log(chalk.dim(`  Total: ${droplets.length} droplets (~$${hourlyCost.toFixed(3)}/hr)`));
		} catch (error) {
			console.error(chalk.red(`[infra list] Error: ${(error as Error).message}`));
			process.exit(1);
		}
	});

// ============================================================================
// CREATE COMMAND
// ============================================================================

// Track status for each droplet during creation
const dropletStatuses = new Map<string, DropletSetupStatus>();

function updateDropletStatus(name: string, status: DropletSetupStatus): void {
	dropletStatuses.set(name, status);
}

function printDropletStatuses(): void {
	for (const [name, status] of dropletStatuses) {
		console.log(`  ${name.padEnd(14)} ${formatStatus(status)}`);
	}
}

program
	.command("create")
	.description("Create DigitalOcean droplets for load testing")
	.option("--count <number>", "Number of droplets to create", "3")
	.option("--name-prefix <prefix>", "Prefix for droplet names", "load-test")
	.option("--branch <branch>", "Git branch to clone", "main")
	.option("--skip-setup", "Skip running the setup script", false)
	.action(async (options: { count: string; namePrefix: string; branch: string; skipSetup: boolean }) => {
		try {
			const config = loadInfraConfig();
			const count = Number.parseInt(options.count, 10);

			console.log(chalk.cyan(`[infra create] Creating ${count} droplet(s) (${DROPLET_REGION}, ${DROPLET_SIZE})...`));
			if (!options.skipSetup) {
				console.log(chalk.dim(`[infra create] Branch: ${options.branch}`));
			}
			console.log("");

			// Get existing droplets to determine next number
			const existing = await listDropletsByPrefix(config.digitalOceanToken, options.namePrefix);
			const existingNumbers = existing
				.map((d) => {
					const match = d.name.match(new RegExp(`^${options.namePrefix}-(\\d+)$`));
					return match ? Number.parseInt(match[1], 10) : 0;
				})
				.filter((n) => n > 0);
			const startNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;

			// Initialize status tracking
			const dropletNames: string[] = [];
			for (let i = 0; i < count; i++) {
				const name = `${options.namePrefix}-${startNumber + i}`;
				dropletNames.push(name);
				updateDropletStatus(name, "creating");
			}
			printDropletStatuses();

			// Create droplets via API (limit concurrency to 5 to avoid rate limits)
			const createdDroplets: DropletInfo[] = [];
			const CONCURRENCY_LIMIT = 5;
			for (let i = 0; i < dropletNames.length; i += CONCURRENCY_LIMIT) {
				const batch = dropletNames.slice(i, i + CONCURRENCY_LIMIT);
				const createPromises = batch.map(async (name) => {
					const droplet = await createDroplet(config.digitalOceanToken, {
						name,
						region: DROPLET_REGION,
						size: DROPLET_SIZE,
						image: DROPLET_IMAGE,
						sshKeyFingerprint: config.sshKeyFingerprint,
					});
					createdDroplets.push(droplet);
					updateDropletStatus(name, "waiting_for_active");
				});
				await Promise.all(createPromises);
			}

			console.log("");
			console.log(chalk.cyan("[infra create] Waiting for droplets to be active..."));

			// Wait for all droplets to be active
			const activePromises = createdDroplets.map(async (d) => {
				const active = await waitForDropletActive(config.digitalOceanToken, d.id);
				updateDropletStatus(d.name, "waiting_for_ssh");
				return active;
			});
			const activeDroplets = await Promise.all(activePromises);

			// Skip setup if requested
			if (options.skipSetup) {
				for (const d of activeDroplets) {
					updateDropletStatus(d.name, "ready");
				}
				console.log("");
				console.log(chalk.green(`[infra create] Complete! ${count}/${count} droplets active (setup skipped).`));
				console.log("");
				printDropletTable(activeDroplets);
				return;
			}

			console.log("");
			console.log(chalk.cyan("[infra create] Running setup on droplets..."));
			console.log(chalk.dim("[infra create] This may take 3-5 minutes..."));
			console.log("");

			// Run setup on all droplets in parallel
			const setupPromises = activeDroplets.map(async (droplet) => {
				try {
					await setupDroplet(droplet, options.branch, config.sshPrivateKeyPath, (d, status) => updateDropletStatus(d.name, status));
				} catch (error) {
					updateDropletStatus(droplet.name, "failed");
					console.error(chalk.red(`  ${droplet.name}: ${(error as Error).message}`));
				}
			});

			await Promise.all(setupPromises);

			// Count successes and failures
			const readyCount = [...dropletStatuses.values()].filter((s) => s === "ready").length;
			const failedCount = [...dropletStatuses.values()].filter((s) => s === "failed").length;

			console.log("");
			if (failedCount === 0) {
				console.log(chalk.green(`[infra create] Complete! ${readyCount}/${count} droplets ready.`));
			} else {
				console.log(chalk.yellow(`[infra create] Done. ${readyCount}/${count} ready, ${failedCount} failed.`));
			}
			console.log("");
			printDropletStatuses();
		} catch (error) {
			console.error(chalk.red(`[infra create] Error: ${(error as Error).message}`));
			process.exit(1);
		}
	});

// ============================================================================
// DESTROY COMMAND
// ============================================================================

program
	.command("destroy")
	.description("Destroy all load test droplets")
	.option("--name-prefix <prefix>", "Prefix to filter droplets", "load-test")
	.option("--yes", "Skip confirmation prompt", false)
	.action(async (options: { namePrefix: string; yes: boolean }) => {
		try {
			const config = loadInfraConfig();
			const droplets = await listDropletsByPrefix(config.digitalOceanToken, options.namePrefix);

			if (droplets.length === 0) {
				console.log(chalk.yellow(`[infra destroy] No droplets found matching prefix "${options.namePrefix}"`));
				return;
			}

			console.log(chalk.cyan(`[infra destroy] Found ${droplets.length} droplet(s) to destroy:`));
			console.log("");
			console.log(`  ${droplets.map((d) => d.name).join(", ")}`);
			console.log("");

			// Confirm unless --yes
			if (!options.yes) {
				const readline = await import("node:readline");
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
				});

				const answer = await new Promise<string>((resolve) => {
					rl.question(chalk.yellow("  Are you sure you want to destroy these droplets? (y/N) "), resolve);
				});
				rl.close();

				if (answer.toLowerCase() !== "y") {
					console.log(chalk.dim("  Cancelled."));
					return;
				}
			}

			console.log(chalk.cyan("[infra destroy] Destroying droplets..."));

			// Delete all in parallel
			const deletePromises = droplets.map(async (d) => {
				await deleteDroplet(config.digitalOceanToken, d.id);
				console.log(`  ${d.name}   ${chalk.green("✓ destroyed")}`);
			});

			await Promise.all(deletePromises);

			console.log("");
			console.log(chalk.green("[infra destroy] All droplets destroyed."));
		} catch (error) {
			console.error(chalk.red(`[infra destroy] Error: ${(error as Error).message}`));
			process.exit(1);
		}
	});

// ============================================================================
// UPDATE COMMAND
// ============================================================================

program
	.command("update")
	.description("Update code on all droplets (git pull && yarn build)")
	.option("--name-prefix <prefix>", "Prefix to filter droplets", "load-test")
	.option("--branch <branch>", "Branch to checkout", "main")
	.action(async (options: { namePrefix: string; branch: string }) => {
		try {
			const config = loadInfraConfig();
			const droplets = await listDropletsByPrefix(config.digitalOceanToken, options.namePrefix);

			if (droplets.length === 0) {
				console.log(chalk.yellow(`[infra update] No droplets found matching prefix "${options.namePrefix}"`));
				return;
			}

			console.log(chalk.cyan(`[infra update] Updating ${droplets.length} droplet(s)...`));
			console.log(chalk.dim(`[infra update] Branch: ${options.branch}`));
			console.log("");

			// Build the update command
			const updateCommand = `cd /app && git fetch && git checkout ${options.branch} && git pull && yarn install && yarn build`;

			const results = await execOnDroplets(droplets, updateCommand, config.sshPrivateKeyPath);

			// Save logs
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
			const logsDir = `results/.infra-logs/update-${timestamp}`;
			saveExecLogs(results, logsDir);

			printExecResults(results);
			console.log("");
			console.log(chalk.dim(`  Full logs: ${logsDir}/`));
		} catch (error) {
			console.error(chalk.red(`[infra update] Error: ${(error as Error).message}`));
			process.exit(1);
		}
	});

// ============================================================================
// EXEC COMMAND
// ============================================================================

program
	.command("exec")
	.description("Execute a command on all droplets")
	.requiredOption("--command <cmd>", "Command to execute")
	.option("--name-prefix <prefix>", "Prefix to filter droplets", "load-test")
	.option("--background", "Run command in background (fire-and-forget)", false)
	.action(async (options: { command: string; namePrefix: string; background: boolean }) => {
		try {
			const config = loadInfraConfig();
			const droplets = await listDropletsByPrefix(config.digitalOceanToken, options.namePrefix);

			if (droplets.length === 0) {
				console.log(chalk.yellow(`[infra exec] No droplets found matching prefix "${options.namePrefix}"`));
				return;
			}

			if (options.background) {
				// Fire-and-forget mode: wrap command in nohup and return immediately
				const bgCommand = `nohup bash -c '${options.command.replace(/'/g, "'\\''")}' > /tmp/load-test-output.log 2>&1 &`;
				console.log(chalk.cyan(`[infra exec] Starting background process on ${droplets.length} droplet(s)...`));
				console.log(chalk.dim(`[infra exec] Command: ${options.command}`));
				console.log("");

				const results = await execOnDroplets(droplets, bgCommand, config.sshPrivateKeyPath);

				const succeeded = results.filter((r) => r.exitCode === 0).length;
				console.log(chalk.green(`[infra exec] Started on ${succeeded}/${droplets.length} droplet(s).`));
				console.log("");
				console.log(chalk.dim("  Use 'yarn infra wait' to wait for completion."));
				console.log(chalk.dim("  Logs are being written to /tmp/load-test-output.log on each droplet."));
			} else {
				// Normal mode: wait for command to complete
				console.log(chalk.cyan(`[infra exec] Running on ${droplets.length} droplet(s)...`));
				console.log(chalk.dim(`[infra exec] Command: ${options.command}`));
				console.log("");

				const results = await execOnDroplets(droplets, options.command, config.sshPrivateKeyPath);

				// Save logs
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
				const logsDir = `results/.infra-logs/exec-${timestamp}`;
				saveExecLogs(results, logsDir);

				printExecResults(results);
				console.log("");
				console.log(chalk.dim(`  Full logs: ${logsDir}/`));
			}
		} catch (error) {
			console.error(chalk.red(`[infra exec] Error: ${(error as Error).message}`));
			process.exit(1);
		}
	});

// ============================================================================
// WAIT COMMAND
// ============================================================================

program
	.command("wait")
	.description("Wait for a file to exist on all droplets (poll until ready)")
	.requiredOption("--file <path>", "Path to file to wait for on each droplet")
	.option("--name-prefix <prefix>", "Prefix to filter droplets", "load-test")
	.option("--timeout <seconds>", "Timeout in seconds", "600")
	.option("--interval <seconds>", "Poll interval in seconds", "5")
	.action(async (options: { file: string; namePrefix: string; timeout: string; interval: string }) => {
		try {
			const config = loadInfraConfig();
			const droplets = await listDropletsByPrefix(config.digitalOceanToken, options.namePrefix);

			if (droplets.length === 0) {
				console.log(chalk.yellow(`[infra wait] No droplets found matching prefix "${options.namePrefix}"`));
				return;
			}

			const timeoutSec = Number.parseInt(options.timeout, 10);
			const intervalSec = Number.parseInt(options.interval, 10);

			console.log(chalk.cyan(`[infra wait] Waiting for ${options.file} on ${droplets.length} droplet(s)...`));
			console.log(chalk.dim(`[infra wait] Timeout: ${timeoutSec}s, Poll interval: ${intervalSec}s`));
			console.log("");

			const startTime = Date.now();
			const completed = new Set<string>();
			const checkCommand = `test -f '${options.file}' && echo 'EXISTS' || echo 'NOT_FOUND'`;

			while (completed.size < droplets.length) {
				const elapsed = (Date.now() - startTime) / 1000;
				if (elapsed >= timeoutSec) {
					console.log("");
					console.log(chalk.red(`[infra wait] Timeout after ${timeoutSec}s. ${completed.size}/${droplets.length} completed.`));
					process.exit(1);
				}

				// Check remaining droplets
				const remaining = droplets.filter((d) => !completed.has(d.name));
				const results = await execOnDroplets(remaining, checkCommand, config.sshPrivateKeyPath);

				for (const result of results) {
					if (result.stdout.includes("EXISTS")) {
						completed.add(result.dropletName);
					}
				}

				// Print progress
				const progressBar = "█".repeat(completed.size) + "░".repeat(droplets.length - completed.size);
				process.stdout.write(`\r  [${progressBar}] ${completed.size}/${droplets.length} complete (${Math.round(elapsed)}s)`);

				if (completed.size < droplets.length) {
					await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
				}
			}

			console.log("");
			console.log("");
			console.log(chalk.green(`[infra wait] All ${droplets.length} droplet(s) have ${options.file}`));
		} catch (error) {
			console.error(chalk.red(`[infra wait] Error: ${(error as Error).message}`));
			process.exit(1);
		}
	});

// ============================================================================
// COLLECT COMMAND
// ============================================================================

program
	.command("collect")
	.description("Collect results from all droplets")
	.requiredOption("--output <dir>", "Directory to store collected results")
	.option("--name-prefix <prefix>", "Prefix to filter droplets", "load-test")
	.option("--remote-path <path>", "Path to results file on droplet", "/tmp/results.json")
	.action(async (options: { output: string; namePrefix: string; remotePath: string }) => {
		try {
			const config = loadInfraConfig();
			const droplets = await listDropletsByPrefix(config.digitalOceanToken, options.namePrefix);

			if (droplets.length === 0) {
				console.log(chalk.yellow(`[infra collect] No droplets found matching prefix "${options.namePrefix}"`));
				return;
			}

			console.log(chalk.cyan(`[infra collect] Collecting from ${droplets.length} droplet(s)...`));
			console.log(chalk.dim(`[infra collect] Remote path: ${options.remotePath}`));
			console.log("");

			const results = await collectFromDroplets(droplets, options.remotePath, options.output, config.sshPrivateKeyPath);

			printCollectResults(results);

			// List downloaded files
			const successful = results.filter((r) => r.success);
			if (successful.length > 0) {
				console.log("");
				console.log(chalk.cyan(`[infra collect] Results saved to ${options.output}/`));
				for (const r of successful) {
					console.log(chalk.dim(`  - ${r.dropletName}.json`));
				}
			}
		} catch (error) {
			console.error(chalk.red(`[infra collect] Error: ${(error as Error).message}`));
			process.exit(1);
		}
	});

program.parse();
