/**
 * Async Delivery Helpers
 *
 * Tests historical message recovery after wallet disconnect/reconnect.
 * These helpers set up a session, disconnect the wallet, send a message,
 * then reconnect and verify the message was recovered from history.
 */
import { type IKVStore, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { DappClient } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import WebSocket from "ws";
import { InMemoryKVStore, MockKeyManager, SAMPLE_REQUEST_PAYLOAD } from "../client/session-pair.js";

/** Result of a single async delivery test. */
export interface AsyncDeliveryTestResult {
	success: boolean;
	sessionId: string;
	/** Time from wallet reconnect to receiving historical message (ms) */
	recoveryLatencyMs?: number;
	error?: string;
}

/** State needed to continue an async delivery test after the delay. */
export interface AsyncDeliverySession {
	sessionId: string;
	url: string;
	dappClient: DappClient;
	walletKvStore: IKVStore;
}

/** Create a session, complete handshake, disconnect wallet, send message. Returns state for later reconnect. */
export async function setupAsyncDeliverySession(url: string, timeoutMs = 60000): Promise<AsyncDeliverySession | null> {
	const dappKvStore = new InMemoryKVStore();
	const walletKvStore = new InMemoryKVStore();
	const dappSessionStore = await SessionStore.create(dappKvStore);
	const walletSessionStore = await SessionStore.create(walletKvStore);
	const keyManager = new MockKeyManager();

	let dappClient: DappClient | null = null;
	let walletClient: WalletClient | null = null;

	try {
		// Create dApp transport and client
		const dappTransport = await WebSocketTransport.create({ url, kvstore: dappKvStore, websocket: WebSocket });
		dappClient = new DappClient({ transport: dappTransport, sessionstore: dappSessionStore, keymanager: keyManager });

		// Start dApp connection - capture both the session_request AND the connect promise
		let sessionRequest: SessionRequest | null = null;
		const sessionRequestPromise = new Promise<SessionRequest>((resolve) => {
			dappClient!.on("session_request", (sr) => {
				sessionRequest = sr;
				resolve(sr);
			});
		});
		const dappConnectPromise = dappClient.connect({ mode: "trusted" });

		// Wait for session request
		await Promise.race([
			sessionRequestPromise,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("session_request timeout")), timeoutMs)),
		]);

		// Create wallet and connect
		const walletTransport = await WebSocketTransport.create({ url, kvstore: walletKvStore, websocket: WebSocket });
		walletClient = new WalletClient({ transport: walletTransport, sessionstore: walletSessionStore, keymanager: keyManager });

		// Wait for BOTH to complete handshake
		await Promise.all([dappConnectPromise, walletClient.connect({ sessionRequest: sessionRequest! })]);

		// Get session ID
		const sessions = await dappSessionStore.list();
		const sessionId = sessions[0]?.id ?? "unknown";

		// Disconnect only the wallet's transport (not the full client) to preserve session data
		await (walletClient as unknown as { transport: { disconnect: () => Promise<void> } }).transport.disconnect();

		// Send message from dApp (goes to history since wallet is disconnected)
		const requestPayload = { ...SAMPLE_REQUEST_PAYLOAD, id: 1 };
		await dappClient.sendRequest(requestPayload);

		return { sessionId, url, dappClient, walletKvStore };
	} catch {
		try {
			await dappClient?.disconnect();
		} catch {
			/* ignore */
		}
		return null;
	}
}

/** Reconnect wallet and verify historical message recovery. */
export async function testAsyncRecovery(session: AsyncDeliverySession, timeoutMs = 30000): Promise<AsyncDeliveryTestResult> {
	const { sessionId, url, dappClient, walletKvStore } = session;
	const keyManager = new MockKeyManager();
	const walletSessionStore = await SessionStore.create(walletKvStore);

	let walletClient: WalletClient | null = null;
	let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

	try {
		// Create new wallet transport
		const walletTransport = await WebSocketTransport.create({ url, kvstore: walletKvStore, websocket: WebSocket });
		walletClient = new WalletClient({ transport: walletTransport, sessionstore: walletSessionStore, keymanager: keyManager });

		// Set up to receive historical message (with proper timeout cleanup)
		const recoveryStart = performance.now();
		let messageResolved = false;

		const messageReceived = new Promise<void>((resolve, reject) => {
			timeoutHandle = setTimeout(() => {
				if (!messageResolved) {
					reject(new Error("Historical message not received within timeout"));
				}
			}, timeoutMs);

			walletClient!.once("message", () => {
				messageResolved = true;
				if (timeoutHandle) clearTimeout(timeoutHandle);
				resolve();
			});
		});

		// Use resume() to reconnect to existing session
		await walletClient.resume(sessionId);

		// Wait for historical message
		await messageReceived;
		const recoveryLatencyMs = performance.now() - recoveryStart;

		// Cleanup timeout
		if (timeoutHandle) clearTimeout(timeoutHandle);

		// Cleanup connections
		await walletClient.disconnect();
		await dappClient.disconnect();

		return { success: true, sessionId, recoveryLatencyMs };
	} catch (error) {
		// Always clean up the timeout
		if (timeoutHandle) clearTimeout(timeoutHandle);

		try {
			await walletClient?.disconnect();
		} catch {
			/* ignore */
		}
		try {
			await dappClient.disconnect();
		} catch {
			/* ignore */
		}
		return { success: false, sessionId, error: error instanceof Error ? error.message : String(error) };
	}
}

