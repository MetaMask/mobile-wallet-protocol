import * as fs from "node:fs";
import { Client } from "ssh2";
import type { ExecResult } from "./types.js";

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for SSH to be available on a droplet.
 * Retries with exponential backoff up to the timeout.
 */
export async function waitForSsh(
	ip: string,
	privateKeyPath: string,
	timeoutMs = 120000,
): Promise<void> {
	const startTime = Date.now();
	let delay = 2000; // Start with 2s delay
	const maxDelay = 10000; // Max 10s between retries

	while (Date.now() - startTime < timeoutMs) {
		try {
			// Try to connect and run a simple command
			await execSsh(ip, "echo ok", privateKeyPath, 10000);
			return; // Success!
		} catch {
			// Not ready yet, wait and retry
			await sleep(delay);
			delay = Math.min(delay * 1.5, maxDelay);
		}
	}

	throw new Error(`SSH not available on ${ip} after ${timeoutMs}ms`);
}

/**
 * Execute a command on a remote host via SSH.
 * Returns the result with stdout, stderr, and exit code.
 */
export async function execSsh(
	ip: string,
	command: string,
	privateKeyPath: string,
	timeoutMs = 300000, // 5 minutes default
): Promise<ExecResult> {
	const startTime = Date.now();
	const privateKey = fs.readFileSync(privateKeyPath, "utf-8");

	return new Promise((resolve, reject) => {
		const client = new Client();
		let stdout = "";
		let stderr = "";
		let exitCode = -1;
		let timedOut = false;

		const timeout = setTimeout(() => {
			timedOut = true;
			client.end();
			reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		client.on("ready", () => {
			client.exec(command, (err, stream) => {
				if (err) {
					clearTimeout(timeout);
					client.end();
					reject(err);
					return;
				}

				stream.on("close", (code: number | null) => {
					clearTimeout(timeout);
					exitCode = code ?? 1; // Assume failure if no exit code
					client.end();
					resolve({
						dropletName: "", // Will be filled in by caller
						dropletIp: ip,
						exitCode,
						stdout,
						stderr,
						durationMs: Date.now() - startTime,
					});
				});

				stream.on("data", (data: Buffer) => {
					stdout += data.toString();
				});

				stream.stderr.on("data", (data: Buffer) => {
					stderr += data.toString();
				});
			});
		});

		client.on("error", (err) => {
			if (!timedOut) {
				clearTimeout(timeout);
				reject(err);
			}
		});

		client.connect({
			host: ip,
			port: 22,
			username: "root",
			privateKey,
			readyTimeout: 20000,
		});
	});
}

/**
 * Download a file from a remote host via SFTP.
 */
export async function downloadFile(
	ip: string,
	remotePath: string,
	localPath: string,
	privateKeyPath: string,
	timeoutMs = 60000, // 1 minute default timeout
): Promise<void> {
	const privateKey = fs.readFileSync(privateKeyPath, "utf-8");

	return new Promise((resolve, reject) => {
		const client = new Client();
		let timedOut = false;

		const timeout = setTimeout(() => {
			timedOut = true;
			client.end();
			reject(new Error(`SFTP download timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		client.on("ready", () => {
			client.sftp((err, sftp) => {
				if (err) {
					clearTimeout(timeout);
					client.end();
					reject(err);
					return;
				}

				sftp.fastGet(remotePath, localPath, (err) => {
					clearTimeout(timeout);
					client.end();
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		});

		client.on("error", (err) => {
			if (!timedOut) {
				clearTimeout(timeout);
				reject(err);
			}
		});

		client.connect({
			host: ip,
			port: 22,
			username: "root",
			privateKey,
			readyTimeout: 20000,
		});
	});
}

