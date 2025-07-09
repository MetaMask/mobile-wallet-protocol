/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import type { IKVStore } from "@metamask/mobile-wallet-protocol-core";
import { SessionStore } from "@metamask/mobile-wallet-protocol-core";
import { DappClient, type SessionRequest } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import * as t from "vitest";
import WebSocket from "ws";

const RELAY_URL = "ws://localhost:8000/connection/websocket";

class InMemoryKVStore implements IKVStore {
	private store = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		return this.store.get(key) || null;
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}
}

t.describe("Integration Test", () => {
	let dappClient: DappClient;
	let walletClient: WalletClient;

	t.beforeEach(() => {
		t.vi.useFakeTimers();
	});

	t.afterEach(async () => {
		// Disconnect clients and clear stores after each test
		await dappClient?.disconnect();
		await walletClient?.disconnect();
		t.vi.useRealTimers();
	});

	t.test(
		"should establish a connection and exchange messages",
		async () => {
			// 1. Setup: Create instances of the DappClient and WalletClient with in-memory stores.
			const dappKvStore = new InMemoryKVStore();
			const walletKvStore = new InMemoryKVStore();
			const dappSessionStore = new SessionStore(dappKvStore);
			const walletSessionStore = new SessionStore(walletKvStore);

			dappClient = await DappClient.create({
				relayUrl: RELAY_URL,
				kvstore: dappKvStore,
				sessionstore: dappSessionStore,
				websocket: WebSocket,
			});

			walletClient = await WalletClient.create({
				relayUrl: RELAY_URL,
				kvstore: walletKvStore,
				sessionstore: walletSessionStore,
				websocket: WebSocket,
			});

			// 2. Handshake Init: Set up promises to resolve when key events are fired.
			const onSessionRequest = new Promise<SessionRequest>((resolve) => {
				dappClient.on("session-request", (sessionRequest) => {
					resolve(sessionRequest);
				});
			});

			const dappConnected = new Promise<void>((resolve) => {
				dappClient.on("connected", () => resolve());
			});

			const walletConnected = new Promise<void>((resolve) => {
				walletClient.on("connected", () => resolve());
			});

			// 3. Dapp starts the connection process, which should trigger the 'session-request' event.
			dappClient.connect();

			// 4. Wallet "scans" the QR code by waiting for the session request data
			//    and then uses it to connect.
			const sessionRequest = await onSessionRequest;
			await walletClient.connect({ sessionRequest });

			// 5. Finalization: Wait for both clients to confirm they are fully connected.
			await Promise.all([dappConnected, walletConnected]);

			// 6. Dapp to Wallet: Dapp sends a request and we wait for the wallet to receive it.
			const requestPayload = { jsonrpc: "2.0", method: "eth_sign", params: ["0xdeadbeef", "0x1234"] };
			const onWalletMessage = new Promise<unknown>((resolve) => {
				walletClient.on("message", (payload) => {
					resolve(payload);
				});
			});
			await dappClient.sendRequest(requestPayload);
			const receivedRequest = await onWalletMessage;
			t.expect(receivedRequest).toEqual(requestPayload);

			// 7. Wallet to Dapp: Wallet sends a response and we wait for the dapp to receive it.
			const responsePayload = { jsonrpc: "2.0", id: 1, result: "0xsigneddeadbeef" };
			const onDappMessage = new Promise<unknown>((resolve) => {
				dappClient.on("message", (payload) => {
					resolve(payload);
				});
			});
			await walletClient.sendResponse(responsePayload);
			const receivedResponse = await onDappMessage;
			t.expect(receivedResponse).toEqual(responsePayload);
		},
		20000,
	);

	t.test(
		"should throw error on the wallet if session request is expired",
		async () => {
			const dappKvStore = new InMemoryKVStore();
			const walletKvStore = new InMemoryKVStore();
			const dappSessionStore = new SessionStore(dappKvStore);
			const walletSessionStore = new SessionStore(walletKvStore);

			dappClient = await DappClient.create({
				relayUrl: RELAY_URL,
				kvstore: dappKvStore,
				sessionstore: dappSessionStore,
				websocket: WebSocket,
			});

			walletClient = await WalletClient.create({
				relayUrl: RELAY_URL,
				kvstore: walletKvStore,
				sessionstore: walletSessionStore,
				websocket: WebSocket,
			});

			const onSessionRequest = new Promise<SessionRequest>((resolve) => {
				dappClient.on("session-request", (sessionRequest) => {
					resolve(sessionRequest);
				});
			});

			dappClient.connect();

			const sessionRequest = await onSessionRequest;

			// Advance time by 61 seconds
			await t.vi.advanceTimersByTimeAsync(61 * 1000);

			await t.expect(walletClient.connect({ sessionRequest })).rejects.toThrow("Session request expired");
		},
		20000,
	);

	t.test(
		"should throw error on the dApp if wallet does not connect in time",
		async () => {
			t.vi.useRealTimers();

			const dappKvStore = new InMemoryKVStore();
			const dappSessionStore = new SessionStore(dappKvStore);

			dappClient = await DappClient.create({
				relayUrl: RELAY_URL,
				kvstore: dappKvStore,
				sessionstore: dappSessionStore,
				websocket: WebSocket,
			});

			// Make timeout faster for testing
			(dappClient as any).timeoutMs = 100;

			// We expect the connect method to throw a timeout error because we are not simulating a wallet connecting.
			await t.expect(dappClient.connect()).rejects.toThrow("Session request timed out");
		},
		5000,
	);

	t.test(
		"should resume a session and exchange messages",
		async () => {
			// 1. Setup: Create instances of the DappClient and WalletClient with in-memory stores.
			const dappKvStore = new InMemoryKVStore();
			const walletKvStore = new InMemoryKVStore();
			const dappSessionStore = new SessionStore(dappKvStore);
			const walletSessionStore = new SessionStore(walletKvStore);

			dappClient = await DappClient.create({
				relayUrl: RELAY_URL,
				kvstore: dappKvStore,
				sessionstore: dappSessionStore,
				websocket: WebSocket,
			});

			walletClient = await WalletClient.create({
				relayUrl: RELAY_URL,
				kvstore: walletKvStore,
				sessionstore: walletSessionStore,
				websocket: WebSocket,
			});

			// 2. Handshake Init
			const onSessionRequest = new Promise<SessionRequest>((resolve) => {
				dappClient.on("session-request", (sessionRequest) => {
					resolve(sessionRequest);
				});
			});

			const dappConnected = new Promise<void>((resolve) => {
				dappClient.on("connected", () => resolve());
			});

			const walletConnected = new Promise<void>((resolve) => {
				walletClient.on("connected", () => resolve());
			});

			dappClient.connect();
			const sessionRequest = await onSessionRequest;
			await walletClient.connect({ sessionRequest });
			await Promise.all([dappConnected, walletConnected]);

			const sessionId = (dappClient as any).session?.id;
			t.expect(sessionId).toBeDefined();

			// 3. Disconnect transport without clearing session by reaching into the client.
			await (dappClient as any).transport.disconnect();
			await (walletClient as any).transport.disconnect();

			// 4. Setup new clients with the same stores to test resumption
			const resumedDappClient = await DappClient.create({
				relayUrl: RELAY_URL,
				kvstore: dappKvStore,
				sessionstore: dappSessionStore,
				websocket: WebSocket,
			});
			dappClient = resumedDappClient; // reassign for afterEach cleanup

			const resumedWalletClient = await WalletClient.create({
				relayUrl: RELAY_URL,
				kvstore: walletKvStore,
				sessionstore: walletSessionStore,
				websocket: WebSocket,
			});
			walletClient = resumedWalletClient; // reassign for afterEach cleanup

			// 5. Resume session
			const resumedDappConnected = new Promise<void>((resolve) => {
				resumedDappClient.on("connected", () => resolve());
			});
			const resumedWalletConnected = new Promise<void>((resolve) => {
				resumedWalletClient.on("connected", () => resolve());
			});

			await Promise.all([resumedDappClient.resume(sessionId as string), resumedWalletClient.resume(sessionId as string)]);

			await Promise.all([resumedDappConnected, resumedWalletConnected]);

			// 6. Exchange messages on resumed session
			const requestPayload = { jsonrpc: "2.0", method: "eth_call", params: [] };
			const onWalletMessage = new Promise<unknown>((resolve) => {
				resumedWalletClient.on("message", (payload) => {
					resolve(payload);
				});
			});
			await resumedDappClient.sendRequest(requestPayload);
			const receivedRequest = await onWalletMessage;
			t.expect(receivedRequest).toEqual(requestPayload);
		},
		20000,
	);
});
