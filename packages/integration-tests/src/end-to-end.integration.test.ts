/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import type { IKVStore } from "@metamask/mobile-wallet-protocol-core";
import { SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
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

			const dappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: WebSocket,
			});

			const walletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: WebSocket,
			});

			dappClient = new DappClient({
				transport: dappTransport,
				sessionstore: dappSessionStore,
			});

			walletClient = new WalletClient({
				transport: walletTransport,
				sessionstore: walletSessionStore,
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

			const dappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: WebSocket,
			});

			const walletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: WebSocket,
			});

			dappClient = new DappClient({
				transport: dappTransport,
				sessionstore: dappSessionStore,
			});

			walletClient = new WalletClient({
				transport: walletTransport,
				sessionstore: walletSessionStore,
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

			const dappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: WebSocket,
			});

			dappClient = new DappClient({
				transport: dappTransport,
				sessionstore: dappSessionStore,
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

			const dappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: WebSocket,
			});

			const walletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: WebSocket,
			});

			dappClient = new DappClient({
				transport: dappTransport,
				sessionstore: dappSessionStore,
			});

			walletClient = new WalletClient({
				transport: walletTransport,
				sessionstore: walletSessionStore,
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
			const resumedDappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: WebSocket,
			});

			const resumedWalletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: WebSocket,
			});

			const resumedDappClient = new DappClient({
				transport: resumedDappTransport,
				sessionstore: dappSessionStore,
			});
			dappClient = resumedDappClient; // reassign for afterEach cleanup

			const resumedWalletClient = new WalletClient({
				transport: resumedWalletTransport,
				sessionstore: walletSessionStore,
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

	t.test(
		"should send messages to offline clients and deliver them when they come back online",
		async () => {
			// 1. Setup: Create instances of the DappClient and WalletClient with in-memory stores.
			const dappKvStore = new InMemoryKVStore();
			const walletKvStore = new InMemoryKVStore();
			const dappSessionStore = new SessionStore(dappKvStore);
			const walletSessionStore = new SessionStore(walletKvStore);

			const dappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: WebSocket,
			});

			const walletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: WebSocket,
			});

			dappClient = new DappClient({
				transport: dappTransport,
				sessionstore: dappSessionStore,
			});

			walletClient = new WalletClient({
				transport: walletTransport,
				sessionstore: walletSessionStore,
			});

			// 2. Initial handshake to establish session
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

			// 3. Disconnect wallet transport while keeping dapp connected (preserving session)
			// We disconnect only the transport layer to simulate a network drop or app crash.
			// This preserves the session data in the kvstore, allowing the client to resume later.
			// Calling a full `walletClient.disconnect()` would permanently delete the session.
			await (walletClient as any).transport.disconnect();

			// 4. Dapp sends multiple messages while wallet is offline
			const offlineMessages = [
				{ jsonrpc: "2.0", method: "eth_sign", params: ["0xoffline1"], id: 1 },
				{ jsonrpc: "2.0", method: "eth_signTypedData", params: ["0xoffline2"], id: 2 },
				{ jsonrpc: "2.0", method: "eth_sendTransaction", params: ["0xoffline3"], id: 3 },
			];

			// Send messages while wallet is offline - these should be queued by the relay
			const sendPromises = offlineMessages.map(async (msg) => {
				await dappClient.sendRequest(msg);
			});
			await Promise.all(sendPromises);

			// 5. Create new wallet client with same storage and reconnect.
			// This simulates a cold start of the app, which reloads its state from disk.
			const reconnectedWalletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: WebSocket,
			});

			const reconnectedWalletClient = new WalletClient({
				transport: reconnectedWalletTransport,
				sessionstore: walletSessionStore,
			});
			walletClient = reconnectedWalletClient; // reassign for afterEach cleanup

			// 6. Set up promise to collect all offline messages
			const receivedMessages: unknown[] = [];
			const offlineMessagesReceived = new Promise<void>((resolve) => {
				const handler = (payload: unknown) => {
					receivedMessages.push(payload);
					if (receivedMessages.length === offlineMessages.length) {
						reconnectedWalletClient.off("message", handler);
						resolve();
					}
				};
				reconnectedWalletClient.on("message", handler);
			});

			const reconnectedWalletConnected = new Promise<void>((resolve) => {
				reconnectedWalletClient.on("connected", () => resolve());
			});

			// 7. Wallet comes back online and should receive all offline messages from history
			await reconnectedWalletClient.resume(sessionId as string);
			await reconnectedWalletConnected;

			// Wait for all offline messages to be received
			await offlineMessagesReceived;

			// 8. Verify all messages were received in the correct order
			t.expect(receivedMessages).toHaveLength(3);
			t.expect(receivedMessages).toEqual(offlineMessages);

			// 9. Test that new real-time messages still work after history delivery
			const realtimeMessage = { jsonrpc: "2.0", method: "eth_accounts", params: [], id: 4 };
			const onRealtimeMessage = new Promise<unknown>((resolve) => {
				reconnectedWalletClient.on("message", (payload) => {
					resolve(payload);
				});
			});

			await dappClient.sendRequest(realtimeMessage);
			const receivedRealtimeMessage = await onRealtimeMessage;
			t.expect(receivedRealtimeMessage).toEqual(realtimeMessage);
		},
		30000,
	);

	t.test(
		"should handle bidirectional offline messaging and message ordering",
		async () => {
			// 1. Setup: Create instances of the DappClient and WalletClient with in-memory stores.
			const dappKvStore = new InMemoryKVStore();
			const walletKvStore = new InMemoryKVStore();
			const dappSessionStore = new SessionStore(dappKvStore);
			const walletSessionStore = new SessionStore(walletKvStore);

			const dappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: WebSocket,
			});

			const walletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: WebSocket,
			});

			dappClient = new DappClient({
				transport: dappTransport,
				sessionstore: dappSessionStore,
			});

			walletClient = new WalletClient({
				transport: walletTransport,
				sessionstore: walletSessionStore,
			});

			// 2. Initial handshake to establish session
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

			// 3. Scenario: Dapp goes offline, wallet sends responses
			// We simulate a transport-only disconnect to preserve the session for resumption.
			await (dappClient as any).transport.disconnect();

			// Wallet sends responses while dapp is offline
			const offlineResponses = [
				{ jsonrpc: "2.0", id: 1, result: "0xsignature1" },
				{ jsonrpc: "2.0", id: 2, result: "0xsignature2" },
			];

			for (const response of offlineResponses) {
				await walletClient.sendResponse(response);
			}

			// 4. Scenario: Both clients offline, then wallet comes back and sends more
			// We simulate a transport-only disconnect to preserve the session for resumption.
			await (walletClient as any).transport.disconnect();

			// Create new wallet client and send more messages
			const reconnectedWalletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: WebSocket,
			});

			const reconnectedWalletClient = new WalletClient({
				transport: reconnectedWalletTransport,
				sessionstore: walletSessionStore,
			});

			const walletReconnected = new Promise<void>((resolve) => {
				reconnectedWalletClient.on("connected", () => resolve());
			});

			await reconnectedWalletClient.resume(sessionId as string);
			await walletReconnected;

			// Send additional response while dapp is still offline
			const additionalResponse = { jsonrpc: "2.0", id: 3, result: "0xsignature3" };
			await reconnectedWalletClient.sendResponse(additionalResponse);

			// 5. Dapp comes back online and should receive all offline messages.
			// This simulates a cold start of the app, which reloads its state from disk.
			const reconnectedDappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: WebSocket,
			});

			const reconnectedDappClient = new DappClient({
				transport: reconnectedDappTransport,
				sessionstore: dappSessionStore,
			});
			dappClient = reconnectedDappClient; // reassign for afterEach cleanup
			walletClient = reconnectedWalletClient; // reassign for afterEach cleanup

			const receivedResponses: unknown[] = [];
			const allResponsesReceived = new Promise<void>((resolve) => {
				const handler = (payload: unknown) => {
					receivedResponses.push(payload);
					if (receivedResponses.length === 3) {
						reconnectedDappClient.off("message", handler);
						resolve();
					}
				};
				reconnectedDappClient.on("message", handler);
			});

			const dappReconnected = new Promise<void>((resolve) => {
				reconnectedDappClient.on("connected", () => resolve());
			});

			await reconnectedDappClient.resume(sessionId as string);
			await dappReconnected;

			// Wait for all offline responses to be received
			await allResponsesReceived;

			// 6. Verify all responses were received in the correct order
			const expectedResponses = [...offlineResponses, additionalResponse];
			t.expect(receivedResponses).toHaveLength(3);
			t.expect(receivedResponses).toEqual(expectedResponses);
		},
		30000,
	);
});
