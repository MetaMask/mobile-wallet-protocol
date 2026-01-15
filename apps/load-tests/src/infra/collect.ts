import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { downloadFile } from "./ssh.js";
import type { DropletInfo } from "./types.js";

/**
 * Result of collecting a file from a droplet.
 */
export interface CollectResult {
	dropletName: string;
	success: boolean;
	localPath?: string;
	fileSize?: number;
	error?: string;
}

/**
 * Collect files from multiple droplets.
 */
export async function collectFromDroplets(
	droplets: DropletInfo[],
	remotePath: string,
	outputDir: string,
	privateKeyPath: string,
	onProgress?: (droplet: DropletInfo, status: "downloading" | "done" | "failed") => void,
): Promise<CollectResult[]> {
	// Create output directory
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const results: CollectResult[] = [];

	const collectPromises = droplets.map(async (droplet) => {
		if (!droplet.ip) {
			const result: CollectResult = {
				dropletName: droplet.name,
				success: false,
				error: "No IP address",
			};
			results.push(result);
			onProgress?.(droplet, "failed");
			return result;
		}

		onProgress?.(droplet, "downloading");

		const localPath = path.join(outputDir, `${droplet.name}.json`);

		try {
			await downloadFile(droplet.ip, remotePath, localPath, privateKeyPath);

			// Get file size
			const stats = fs.statSync(localPath);
			const result: CollectResult = {
				dropletName: droplet.name,
				success: true,
				localPath,
				fileSize: stats.size,
			};
			results.push(result);
			onProgress?.(droplet, "done");
			return result;
		} catch (error) {
			const result: CollectResult = {
				dropletName: droplet.name,
				success: false,
				error: (error as Error).message,
			};
			results.push(result);
			onProgress?.(droplet, "failed");
			return result;
		}
	});

	await Promise.all(collectPromises);
	return results;
}

/**
 * Format file size in a human-readable way.
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(1)} KB`;
	const mb = kb / 1024;
	return `${mb.toFixed(1)} MB`;
}

/**
 * Print collection results summary.
 */
export function printCollectResults(results: CollectResult[]): void {
	const successful = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);

	console.log("");
	if (failed.length === 0) {
		console.log(chalk.green(`[infra collect] Complete! ${successful.length}/${results.length} files downloaded.`));
	} else {
		console.log(chalk.yellow(`[infra collect] Done. ${successful.length}/${results.length} downloaded, ${failed.length} failed.`));
	}
	console.log("");

	for (const result of results) {
		if (result.success) {
			console.log(`  ${result.dropletName.padEnd(14)} ${chalk.green("✓")} downloaded (${formatFileSize(result.fileSize ?? 0)})`);
		} else {
			console.log(`  ${result.dropletName.padEnd(14)} ${chalk.red("✗")} ${result.error}`);
		}
	}
}

