// Path: lib/SessionManager.ts
import { type Session, type SessionRequest, type SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import EventEmitter from "eventemitter3";
import { AsyncStorageKVStore } from "./AsyncStorageKVStore";

// This type can be moved to a more central location later
export type GlobalActivityLogEntry = {
	id: string;
	sessionId: string;
	type: "sent" | "received" | "error" | "system";
	message: string;
	timestamp: string;
};

/**
 * Manages all active WalletClient sessions.
 * It is responsible for creating, resuming, and deleting client instances.
 */
export class SessionManager extends EventEmitter {
	private clients: Map<string, WalletClient> = new Map();
	private sessionStore: SessionStore;
	private relayUrl: string;

	constructor(sessionStore: SessionStore, relayUrl: string) {
		super();
		this.sessionStore = sessionStore;
		this.relayUrl = relayUrl;
	}

	/**
	 * Scans the SessionStore for all persisted sessions and attempts to resume them.
	 * This should be called once on application startup.
	 */
	public async resumeAllClients(): Promise<void> {
		console.log("SessionManager: Resuming all clients...");
		const sessions = await this.sessionStore.list();
		console.log(`SessionManager: Found ${sessions.length} sessions to resume.`);

		const resumePromises = sessions.map(async (session) => {
			try {
				const client = await this.createClient();
				await client.resume(session.id);
				this.clients.set(session.id, client);
				this.setupClientListeners(client, session.id);
				console.log(`SessionManager: Successfully resumed session ${session.id}`);
				this.emit("system-log", { sessionId: session.id, message: "Session resumed" });
			} catch (e) {
				console.error(`SessionManager: Failed to resume session ${session.id}`, e);
				await this.sessionStore.delete(session.id);
			}
		});

		await Promise.all(resumePromises);
		this.emit("sessions-changed");
	}

	/**
	 * Creates a new WalletClient and establishes a new session using a SessionRequest.
	 * @param sessionRequest The request object from the scanned QR code.
	 */
	public async createClientForSession(sessionRequest: SessionRequest): Promise<WalletClient> {
		console.log(`SessionManager: Creating new client for session request ${sessionRequest.id}`);
		const client = await this.createClient();

		this.emit("system-log", { sessionId: sessionRequest.id, message: `Incoming connection request (mode: ${sessionRequest.mode})` });

		// Listen for the OTP event just for this connection attempt.
		client.once("display_otp", (otp: string, deadline: number) => {
			this.emit("otp_display_request", { otp, deadline });
		});

		// The 'connect' promise now waits for the full handshake, including OTP verification.
		await client.connect({ sessionRequest });

		// Add this line:
		this.emit("handshake_complete");

		this.clients.set(sessionRequest.id, client);
		this.setupClientListeners(client, sessionRequest.id);
		console.log(`SessionManager: New session ${sessionRequest.id} connected.`);
		this.emit("system-log", { sessionId: sessionRequest.id, message: "New session created" });
		this.emit("sessions-changed");
		return client;
	}

	public async deleteClient(sessionId: string): Promise<void> {
		const client = this.clients.get(sessionId);
		if (client) {
			console.log(`SessionManager: Deleting client for session ${sessionId}`);
			await client.disconnect(); // This also deletes from sessionStore
			client.removeAllListeners();
			this.clients.delete(sessionId);
			this.emit("system-log", { sessionId, message: "Session deleted" });
			this.emit("sessions-changed");
		}
	}

	public async deleteAllClients(): Promise<void> {
		console.log("SessionManager: Deleting all clients...");
		const allSessions = Array.from(this.clients.keys());
		await Promise.all(allSessions.map((id) => this.deleteClient(id)));
	}

	public getClient(sessionId: string): WalletClient | undefined {
		return this.clients.get(sessionId);
	}

	public getAllSessions(): Promise<Session[]> {
		return this.sessionStore.list();
	}

	/**
	 * Creates a new WalletClient instance with its own transport layer.
	 */
	private async createClient(): Promise<WalletClient> {
		// Each client needs its own transport instance, but they can share the same underlying kvstore prefix
		// as the transport keys are namespaced by channel.
		const kvstore = new AsyncStorageKVStore("wallet-transport-");
		const transport = await WebSocketTransport.create({
			url: this.relayUrl,
			kvstore,
			websocket: WebSocket,
		});
		return new WalletClient({
			transport,
			sessionstore: this.sessionStore,
		});
	}

	/**
	 * Sets up event listeners on a WalletClient to forward events to the SessionManager.
	 */
	private setupClientListeners(client: WalletClient, sessionId: string) {
		client.on("message", (payload: unknown) => {
			this.emit("message-received", {
				sessionId,
				payload,
			} as { sessionId: string; payload: unknown });
		});
		client.on("error", (error: Error) => {
			console.error(`SessionManager: Error on session ${sessionId}:`, error);
			this.emit("error", { sessionId, error });
		});
	}
}
