import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { execSsh } from "./ssh.js";
import type { DropletInfo, ExecResult } from "./types.js";

/**
 * Execute a command on multiple droplets in parallel.
 * Returns results for each droplet.
 */
export async function execOnDroplets(
	droplets: DropletInfo[],
	command: string,
	privateKeyPath: string,
	onProgress?: (droplet: DropletInfo, status: "running" | "done" | "failed") => void,
): Promise<ExecResult[]> {
	const results: ExecResult[] = [];

	const execPromises = droplets.map(async (droplet) => {
		if (!droplet.ip) {
			const result: ExecResult = {
				dropletName: droplet.name,
				dropletIp: "",
				exitCode: -1,
				stdout: "",
				stderr: "",
				durationMs: 0,
				error: "No IP address",
			};
			results.push(result);
			onProgress?.(droplet, "failed");
			return result;
		}

		onProgress?.(droplet, "running");

		try {
			const result = await execSsh(droplet.ip, command, privateKeyPath);
			result.dropletName = droplet.name;
			results.push(result);
			onProgress?.(droplet, result.exitCode === 0 ? "done" : "failed");
			return result;
		} catch (error) {
			const result: ExecResult = {
				dropletName: droplet.name,
				dropletIp: droplet.ip,
				exitCode: -1,
				stdout: "",
				stderr: "",
				durationMs: 0,
				error: (error as Error).message,
			};
			results.push(result);
			onProgress?.(droplet, "failed");
			return result;
		}
	});

	await Promise.all(execPromises);
	return results;
}

/**
 * Save execution logs to a directory.
 * Creates one file per droplet with stdout/stderr.
 */
export function saveExecLogs(
	results: ExecResult[],
	logsDir: string,
): void {
	// Create logs directory
	if (!fs.existsSync(logsDir)) {
		fs.mkdirSync(logsDir, { recursive: true });
	}

	for (const result of results) {
		const logPath = path.join(logsDir, `${result.dropletName}.log`);
		let content = `# ${result.dropletName} (${result.dropletIp})\n`;
		content += `# Exit code: ${result.exitCode}\n`;
		content += `# Duration: ${result.durationMs}ms\n`;
		if (result.error) {
			content += `# Error: ${result.error}\n`;
		}
		content += "\n--- STDOUT ---\n";
		content += result.stdout || "(empty)\n";
		content += "\n--- STDERR ---\n";
		content += result.stderr || "(empty)\n";

		fs.writeFileSync(logPath, content);
	}
}

/**
 * Format a duration in a human-readable way.
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Print execution results summary.
 */
export function printExecResults(results: ExecResult[]): void {
	const successful = results.filter((r) => r.exitCode === 0);
	const failed = results.filter((r) => r.exitCode !== 0);

	console.log("");
	if (failed.length === 0) {
		console.log(chalk.green(`[infra exec] Complete! ${successful.length}/${results.length} succeeded.`));
	} else {
		console.log(chalk.yellow(`[infra exec] Done. ${successful.length}/${results.length} succeeded, ${failed.length} failed.`));
	}
	console.log("");

	for (const result of results) {
		const icon = result.exitCode === 0 ? chalk.green("✓") : chalk.red("✗");
		const exitCodeStr = result.error
			? chalk.red(`error: ${result.error.substring(0, 30)}`)
			: result.exitCode === 0
				? chalk.green(`exit ${result.exitCode}`)
				: chalk.red(`exit ${result.exitCode}`);
		console.log(`  ${result.dropletName.padEnd(14)} ${icon} ${exitCodeStr}   (${formatDuration(result.durationMs)})`);
	}
}

