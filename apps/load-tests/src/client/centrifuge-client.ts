import { Centrifuge } from "centrifuge";
import WebSocket from "ws";

/**
 * Connection outcome types:
 * - immediate: Connected on first try
 * - recovered: Failed initially but reconnected successfully
 * - failed: Could not connect after all retries
 */
export type ConnectionOutcome = "immediate" | "recovered" | "failed";

export interface ConnectionResult {
	success: boolean;
	outcome: ConnectionOutcome;
	connectionTimeMs: number;
	retryCount: number;
	error?: string;
}

export interface CentrifugeClientOptions {
	url: string;
	timeoutMs?: number;
	minReconnectDelay?: number;
	maxReconnectDelay?: number;
}

/**
 * Wrapper around the Centrifuge client for load testing.
 * Connects to a Centrifugo server and measures connection time.
 * Supports automatic reconnection with tracking of outcomes.
 */
export class CentrifugeClient {
	private client: Centrifuge | null = null;
	private readonly url: string;
	private readonly timeoutMs: number;
	private readonly minReconnectDelay: number;
	private readonly maxReconnectDelay: number;

	constructor(options: CentrifugeClientOptions) {
		this.url = options.url;
		this.timeoutMs = options.timeoutMs ?? 30000;
		this.minReconnectDelay = options.minReconnectDelay ?? 500;
		this.maxReconnectDelay = options.maxReconnectDelay ?? 5000;
	}

	/**
	 * Connect to the Centrifugo server.
	 * Returns connection timing, outcome, and retry info.
	 * Will wait for reconnection if initial connection fails.
	 */
	async connect(): Promise<ConnectionResult> {
		const startTime = performance.now();
		let retryCount = 0;
		let hadError = false;

		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				this.disconnect();
				resolve({
					success: false,
					outcome: "failed",
					connectionTimeMs: performance.now() - startTime,
					retryCount,
					error: `Connection timeout after ${this.timeoutMs}ms`,
				});
			}, this.timeoutMs);

			this.client = new Centrifuge(this.url, {
				websocket: WebSocket,
				minReconnectDelay: this.minReconnectDelay,
				maxReconnectDelay: this.maxReconnectDelay,
				timeout: 10000,
			});

			this.client.on("connected", () => {
				clearTimeout(timeout);
				resolve({
					success: true,
					outcome: hadError ? "recovered" : "immediate",
					connectionTimeMs: performance.now() - startTime,
					retryCount,
				});
			});

			// Track errors but don't resolve - let it retry
			this.client.on("error", () => {
				hadError = true;
				retryCount++;
			});

			this.client.connect();
		});
	}

	/**
	 * Disconnect from the server.
	 */
	disconnect(): void {
		if (this.client) {
			this.client.disconnect();
			this.client = null;
		}
	}

	/**
	 * Check if currently connected.
	 */
	isConnected(): boolean {
		return this.client?.state === "connected";
	}
}

