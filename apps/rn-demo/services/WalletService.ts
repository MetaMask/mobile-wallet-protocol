import { type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import EventEmitter from "eventemitter3";

import { AsyncStorageKVStore } from "@/lib/AsyncStorageKVStore";

const RELAY_URL = "ws://localhost:8000/connection/websocket";

// Define a type for incoming requests for better handling
export type PendingRequest = {
	id: number | string;
	method: string;
	params: unknown;
};

class WalletService extends EventEmitter {
	private static instance: WalletService;
	public walletClient: WalletClient | null = null;
	public status = "Disconnected";
	private sessionStore: SessionStore | null = null;

	private constructor() {
		super();
		this.initialize();
	}

	public static getInstance(): WalletService {
		if (!WalletService.instance) {
			WalletService.instance = new WalletService();
		}
		return WalletService.instance;
	}

	private async initialize() {
		console.log("Initializing WalletService...");
		const kvStore = new AsyncStorageKVStore("rn-wallet-");
		const transport = await WebSocketTransport.create({
			url: RELAY_URL,
			kvstore: kvStore,
		});
		this.sessionStore = new SessionStore(kvStore);

		this.walletClient = new WalletClient({
			transport,
			sessionstore: this.sessionStore,
		});

		this.walletClient.on("connected", () => {
			this.status = "Connected";
			this.emit("statusChange", this.status);
		});

		this.walletClient.on("disconnected", () => {
			this.status = "Disconnected";
			this.emit("statusChange", this.status);
		});

		this.walletClient.on("error", (error) => {
			console.error("WalletService Error:", error);
			this.status = `Error: ${error.message}`;
			this.emit("statusChange", this.status);
		});

		this.walletClient.on("message", (payload: unknown) => {
			console.log("WalletService: Message received", payload);
			if (this.isPendingRequest(payload)) {
				this.emit("request", payload);
			}
		});

		console.log("WalletService Initialized.");
		this.emit("initialized");
	}

	private isPendingRequest(payload: unknown): payload is PendingRequest {
		return (
			typeof payload === "object" &&
			payload !== null &&
			"id" in payload &&
			"method" in payload &&
			"params" in payload
		);
	}

	public async connect(sessionRequest: SessionRequest) {
		if (!this.walletClient) return;
		try {
			this.status = "Connecting...";
			this.emit("statusChange", this.status);
			await this.walletClient.connect({ sessionRequest });
		} catch (error) {
			this.handleError(error, "connect");
		}
	}

	public async resumeLastSession() {
		if (!this.walletClient || !this.sessionStore) return;
		try {
			const sessions = await this.sessionStore.list();
			if (sessions.length > 0) {
				const lastSession = sessions[0]; // Assuming the first is the most recent
				this.status = `Resuming session ${lastSession.id}...`;
				this.emit("statusChange", this.status);
				await this.walletClient.resume(lastSession.id);
			}
		} catch (error) {
			this.handleError(error, "resume");
		}
	}

	public async disconnect() {
		if (!this.walletClient) return;
		try {
			await this.walletClient.disconnect();
		} catch (error) {
			this.handleError(error, "disconnect");
		}
	}

	public async sendResponse(response: { id: number | string, result?: unknown, error?: unknown }) {
		if (!this.walletClient || this.status !== "Connected") {
			console.error("Cannot send response: not connected.");
			return;
		}
		try {
			await this.walletClient.sendResponse(response);
		} catch (error) {
			this.handleError(error, "sendResponse");
		}
	}

	private handleError(error: unknown, context: string) {
		console.error(`Failed to ${context}:`, error);
		this.status = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
		this.emit("statusChange", this.status);
	}
}

// Export a singleton instance
export const walletService = WalletService.getInstance();
