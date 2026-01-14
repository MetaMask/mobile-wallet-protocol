import { type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { DappClient } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import WebSocket from "ws";
import { InMemoryKVStore } from "../utils/kvstore.js";
import { sleep } from "../utils/timing.js";
import { MockKeyManager } from "./key-manager.js";

// Re-export for use by other modules
export { InMemoryKVStore } from "../utils/kvstore.js";
export { MockKeyManager } from "./key-manager.js";

// Simulates QR scan time. Session request sits in Centrifugo history during this delay.
const WALLET_CONNECT_DELAY_MS = 5000;

// Simulates user interaction time between messages.
const MESSAGE_DELAY_MS = 1000;

/**
 * Result of a message exchange (request + response round-trip).
 */
export interface MessageExchangeResult {
	success: boolean;
	/** Round-trip latency in milliseconds (send request → receive response) */
	latencyMs: number;
	/** Message ID for verification */
	messageId?: number;
	error?: string;
}

/**
 * Result of establishing a session pair.
 */
export interface SessionPairResult {
	success: boolean;
	/** Time to complete handshake in milliseconds (includes wallet connect delay) */
	handshakeTimeMs: number;
	/** The connected session pair (only if success is true) */
	pair?: SessionPair;
	error?: string;
}

/**
 * A connected dApp + Wallet pair ready for messaging.
 */
export interface SessionPair {
	dapp: DappClient;
	wallet: WalletClient;
	sessionId: string;

	/**
	 * Exchange a message: dApp sends request, wallet responds.
	 * Includes a delay to simulate user interaction.
	 * Returns the round-trip latency (excluding the artificial delay).
	 */
	exchangeMessage(messageId: number): Promise<MessageExchangeResult>;

	/**
	 * Disconnect both clients.
	 */
	disconnect(): Promise<void>;
}

/**
 * Options for creating a session pair.
 */
export interface CreateSessionPairOptions {
	url: string;
	/** Timeout for handshake in milliseconds (default: 60000) */
	handshakeTimeoutMs?: number;
}

/**
 * Create a connected dApp + Wallet session pair using trusted mode.
 * Includes a realistic delay before wallet connects (simulates QR scan).
 */
export async function createSessionPair(options: CreateSessionPairOptions): Promise<SessionPairResult> {
	const { url, handshakeTimeoutMs = 60000 } = options;

	// Create isolated stores for each client
	const dappKvStore = new InMemoryKVStore();
	const walletKvStore = new InMemoryKVStore();
	const dappSessionStore = new SessionStore(dappKvStore);
	const walletSessionStore = new SessionStore(walletKvStore);

	// Use MockKeyManager - no real crypto (see key-manager.ts for rationale)
	const keyManager = new MockKeyManager();

	let dappTransport: WebSocketTransport | null = null;
	let walletTransport: WebSocketTransport | null = null;
	let dappClient: DappClient | null = null;
	let walletClient: WalletClient | null = null;

	try {
		// === STEP 1: Create dApp client and initiate connection ===
		dappTransport = await WebSocketTransport.create({
			url,
			kvstore: dappKvStore,
			websocket: WebSocket,
		});

		dappClient = new DappClient({
			transport: dappTransport,
			sessionstore: dappSessionStore,
			keymanager: keyManager,
		});

		// Start dApp connection and capture session request
		const sessionRequest = await initiateDappConnection(dappClient, handshakeTimeoutMs);

		// === STEP 2: Simulate user delay (QR scan time) ===
		await sleep(WALLET_CONNECT_DELAY_MS);

		// Start timing AFTER the artificial delay (measure actual handshake only)
		const handshakeStartTime = performance.now();

		// === STEP 3: Create wallet client and connect ===
		walletTransport = await WebSocketTransport.create({
			url,
			kvstore: walletKvStore,
			websocket: WebSocket,
		});

		walletClient = new WalletClient({
			transport: walletTransport,
			sessionstore: walletSessionStore,
			keymanager: keyManager,
		});

		// Connect wallet (will receive session_request from history)
		await connectWallet(walletClient, sessionRequest, handshakeTimeoutMs);

		// Measure actual handshake time (excludes artificial delay)
		const handshakeTimeMs = performance.now() - handshakeStartTime;

		// Get session ID
		const sessions = await dappSessionStore.list();
		const sessionId = sessions[0]?.id ?? "unknown";

		// Create the session pair object
		const pair: SessionPair = {
			dapp: dappClient,
			wallet: walletClient,
			sessionId,
			exchangeMessage: createMessageExchanger(dappClient, walletClient),
			disconnect: createDisconnector(dappClient, walletClient),
		};

		return {
			success: true,
			handshakeTimeMs,
			pair,
		};
	} catch (error) {
		// Cleanup on failure
		try {
			await dappClient?.disconnect();
		} catch {
			// Ignore cleanup errors
		}
		try {
			await walletClient?.disconnect();
		} catch {
			// Ignore cleanup errors
		}

		return {
			success: false,
			handshakeTimeMs: 0, // Failed handshakes don't have meaningful timing
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Initiate dApp connection and return session request (doesn't wait for handshake). */
async function initiateDappConnection(dappClient: DappClient, timeoutMs: number): Promise<SessionRequest> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`DApp session_request timeout after ${timeoutMs}ms`));
		}, timeoutMs);

		dappClient.on("session_request", (sessionRequest) => {
			clearTimeout(timeout);
			resolve(sessionRequest);
		});

		// Start connection (trusted mode - no OTP)
		// This promise resolves when handshake completes, but we don't await it here
		dappClient.connect({ mode: "trusted" }).catch((error) => {
			clearTimeout(timeout);
			reject(error);
		});
	});
}

/** Connect wallet with session request. */
async function connectWallet(walletClient: WalletClient, sessionRequest: SessionRequest, timeoutMs: number): Promise<void> {
	const connectPromise = walletClient.connect({ sessionRequest });

	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(() => {
			reject(new Error(`Wallet connect timeout after ${timeoutMs}ms`));
		}, timeoutMs);
	});

	await Promise.race([connectPromise, timeoutPromise]);
}

/**
 * Create a message exchange function. Message ID is used for verification.
 */
function createMessageExchanger(dappClient: DappClient, walletClient: WalletClient): SessionPair["exchangeMessage"] {
	return async (messageId: number): Promise<MessageExchangeResult> => {
		// Simulate user interaction delay before sending
		await sleep(MESSAGE_DELAY_MS);

		const startTime = performance.now();

		try {
			// Create payloads with message ID for verification
			const requestPayload = { ...SAMPLE_REQUEST_PAYLOAD, id: messageId };
			const responsePayload = { ...SAMPLE_RESPONSE_PAYLOAD, id: messageId };

			// Set up wallet to receive message and respond
			const walletReceivePromise = new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error(`Wallet did not receive message ${messageId} within 30s`));
				}, 30000);

				walletClient.once("message", async () => {
					clearTimeout(timeout);
					try {
						await walletClient.sendResponse(responsePayload);
						resolve();
					} catch (error) {
						reject(error);
					}
				});
			});

			// Set up dApp to receive response
			const dappReceivePromise = new Promise<number>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error(`DApp did not receive response ${messageId} within 30s`));
				}, 30000);

				dappClient.once("message", (msg: unknown) => {
					clearTimeout(timeout);
					// Extract message ID for verification
					const receivedId = (msg as { id?: number })?.id ?? -1;
					resolve(receivedId);
				});
			});

			// Send request from dApp
			await dappClient.sendRequest(requestPayload);

			// Wait for full round-trip
			const [, receivedId] = await Promise.all([walletReceivePromise, dappReceivePromise]);

			const latencyMs = performance.now() - startTime;

			// Verify message ID matches
			if (receivedId !== messageId) {
				return {
					success: false,
					latencyMs,
					messageId,
					error: `Message ID mismatch: sent ${messageId}, received ${receivedId}`,
				};
			}

			return { success: true, latencyMs, messageId };
		} catch (error) {
			const latencyMs = performance.now() - startTime;
			return {
				success: false,
				latencyMs,
				messageId,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
}

/**
 * Create a disconnect function for a session pair.
 */
function createDisconnector(dappClient: DappClient, walletClient: WalletClient): SessionPair["disconnect"] {
	return async () => {
		const errors: Error[] = [];

		try {
			await dappClient.disconnect();
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}

		try {
			await walletClient.disconnect();
		} catch (error) {
			errors.push(error instanceof Error ? error : new Error(String(error)));
		}

		if (errors.length > 0) {
			throw new Error(`Disconnect errors: ${errors.map((e) => e.message).join(", ")}`);
		}
	};
}

/** Sample personal_sign request payload (~150 bytes). */
export const SAMPLE_REQUEST_PAYLOAD = {
	method: "personal_sign",
	params: ["0x4578616d706c65206d65737361676520746f207369676e", "0x1234567890abcdef1234567890abcdef12345678"],
	id: 1,
};

/** Sample signature response payload (~140 bytes). */
export const SAMPLE_RESPONSE_PAYLOAD = {
	result: "0x1b2a3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b01",
	id: 1,
};
