import { type IKVStore, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { DappClient, type OtpRequiredPayload } from "@metamask/mobile-wallet-protocol-dapp-client";
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

// Helper function to establish a full, successful connection between a Dapp and Wallet client.
async function connectClients(dappClient: DappClient, walletClient: WalletClient) {
	const sessionRequestPromise = new Promise<SessionRequest>((resolve) => {
		dappClient.on("session_request", resolve);
	});
	const dappConnectPromise = dappClient.connect();

	const sessionRequest = await sessionRequestPromise;

	const otpPromise = new Promise<{ otp: string }>((resolve) => {
		walletClient.on("display_otp", (otp) => resolve({ otp }));
	});
	const walletConnectPromise = walletClient.connect({ sessionRequest });

	const { otp } = await otpPromise;

	const otpRequiredPromise = new Promise<OtpRequiredPayload>((resolve) => {
		dappClient.on("otp_required", resolve);
	});
	const otpPayload = await otpRequiredPromise;

	await otpPayload.submit(otp);

	await Promise.all([dappConnectPromise, walletConnectPromise]);
}

t.describe("E2E Integration Test", () => {
	let dappClient: DappClient;
	let walletClient: WalletClient;
	let dappKvStore: InMemoryKVStore;
	let walletKvStore: InMemoryKVStore;
	let dappSessionStore: SessionStore;
	let walletSessionStore: SessionStore;

	t.beforeEach(async () => {
		dappKvStore = new InMemoryKVStore();
		walletKvStore = new InMemoryKVStore();
		dappSessionStore = new SessionStore(dappKvStore);
		walletSessionStore = new SessionStore(walletKvStore);

		const dappTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: dappKvStore, websocket: WebSocket });
		const walletTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: walletKvStore, websocket: WebSocket });

		dappClient = new DappClient({ transport: dappTransport, sessionstore: dappSessionStore });
		walletClient = new WalletClient({ transport: walletTransport, sessionstore: walletSessionStore });
	});

	t.afterEach(async () => {
		// Use a try-catch to prevent errors from one client's disconnect affecting the other's cleanup.
		try {
			await dappClient?.disconnect();
		} catch (e) {
			console.error("Error disconnecting dappClient:", e);
		}
		try {
			await walletClient?.disconnect();
		} catch (e) {
			console.error("Error disconnecting walletClient:", e);
		}
	});

	t.test("should complete the full end-to-end connection successfully", async () => {
		await connectClients(dappClient, walletClient);

		// @ts-expect-error - accessing private property for test
		t.expect(dappClient.state).toBe("CONNECTED");
		// @ts-expect-error - accessing private property for test
		t.expect(walletClient.state).toBe("CONNECTED");

		const dappSessions = await dappSessionStore.list();
		const walletSessions = await walletSessionStore.list();
		t.expect(dappSessions).toHaveLength(1);
		t.expect(walletSessions).toHaveLength(1);
		t.expect(dappSessions[0].id).toEqual(walletSessions[0].id);
	});

	t.test("should allow bidirectional messaging after connection", async () => {
		await connectClients(dappClient, walletClient);

		// DApp -> Wallet
		const requestPayload = { method: "eth_accounts" };
		const messageFromDappPromise = new Promise((resolve) => walletClient.on("message", resolve));
		await dappClient.sendRequest(requestPayload);
		await t.expect(messageFromDappPromise).resolves.toEqual(requestPayload);

		// Wallet -> DApp
		const responsePayload = { result: ["0x123..."] };
		const messageFromWalletPromise = new Promise((resolve) => dappClient.on("message", resolve));
		await walletClient.sendResponse(responsePayload);
		await t.expect(messageFromWalletPromise).resolves.toEqual(responsePayload);
	});

	t.test("should successfully resume a previously established session", async () => {
		// 1. Establish a connection first
		await connectClients(dappClient, walletClient);
		const sessionId = (await dappSessionStore.list())[0].id;

		// 2. Simulate transport disconnection
		// @ts-expect-error - accessing protected property for test simulation
		await dappClient.transport.disconnect();
		// @ts-expect-error - accessing protected property for test simulation
		await walletClient.transport.disconnect();

		// 3. Create new clients with the same stores (simulating app restart)
		const newDappTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: dappKvStore, websocket: WebSocket });
		const newWalletTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: walletKvStore, websocket: WebSocket });
		const resumedDappClient = new DappClient({ transport: newDappTransport, sessionstore: dappSessionStore });
		const resumedWalletClient = new WalletClient({ transport: newWalletTransport, sessionstore: walletSessionStore });
		dappClient = resumedDappClient; // Reassign for cleanup
		walletClient = resumedWalletClient; // Reassign for cleanup

		// 4. Resume the session
		await t.expect(resumedDappClient.resume(sessionId)).resolves.toBeUndefined();
		await t.expect(resumedWalletClient.resume(sessionId)).resolves.toBeUndefined();

		// 5. Verify messaging still works
		const testPayload = { message: "hello after resume" };
		const messagePromise = new Promise((resolve) => resumedWalletClient.on("message", resolve));
		await resumedDappClient.sendRequest(testPayload);
		await t.expect(messagePromise).resolves.toEqual(testPayload);
	});

	t.test("should deliver messages sent while a client was offline", async () => {
		// 1. Establish a connection
		await connectClients(dappClient, walletClient);
		const sessionId = (await walletSessionStore.list())[0].id;

		// 2. Disconnect only the wallet's transport layer to simulate being offline
		// @ts-expect-error - accessing protected property for test
		await walletClient.transport.disconnect();

		// 3. DApp sends messages while wallet is offline
		const offlineMessages = [{ id: 1 }, { id: 2 }];
		for (const msg of offlineMessages) {
			await dappClient.sendRequest(msg);
		}

		// 4. Recreate wallet client and resume
		const newWalletTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: walletKvStore, websocket: WebSocket });
		const resumedWalletClient = new WalletClient({ transport: newWalletTransport, sessionstore: walletSessionStore });
		walletClient = resumedWalletClient; // Reassign for cleanup

		const receivedMessages: unknown[] = [];
		const allMessagesReceived = new Promise<void>((resolve) => {
			resumedWalletClient.on("message", (payload) => {
				receivedMessages.push(payload);
				if (receivedMessages.length === offlineMessages.length) {
					resolve();
				}
			});
		});

		// 5. Resume and wait for history to be delivered
		await resumedWalletClient.resume(sessionId);
		await allMessagesReceived;

		t.expect(receivedMessages).toEqual(offlineMessages);
	});

	t.test("disconnect() should clear session storage on both sides", async () => {
		await connectClients(dappClient, walletClient);
		t.expect(await dappSessionStore.list()).toHaveLength(1);
		t.expect(await walletSessionStore.list()).toHaveLength(1);

		await dappClient.disconnect();

		// After dapp disconnects, its session store should be empty. Wallet's should still exist.
		t.expect(await dappSessionStore.list()).toHaveLength(0);
		t.expect(await walletSessionStore.list()).toHaveLength(1);

		await walletClient.disconnect();
		t.expect(await walletSessionStore.list()).toHaveLength(0);
	});
});
