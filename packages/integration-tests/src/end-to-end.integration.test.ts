/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import { type ConnectionMode, type IKVStore, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
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

// Helper function to handle both connection modes.
async function connectClients(dappClient: DappClient, walletClient: WalletClient, mode: ConnectionMode) {
	const sessionRequestPromise = new Promise<SessionRequest>((resolve) => {
		dappClient.on("session_request", resolve);
	});
	const dappConnectPromise = dappClient.connect({ mode });

	const sessionRequest = await sessionRequestPromise;

	const walletConnectPromise = walletClient.connect({ sessionRequest });

	// Conditionally handle the OTP steps only for the untrusted flow.
	if (mode === "untrusted") {
		const otpPromise = new Promise<string>((resolve) => {
			walletClient.on("display_otp", (otp) => resolve(otp));
		});
		const otp = await otpPromise;

		const otpRequiredPromise = new Promise<OtpRequiredPayload>((resolve) => {
			dappClient.on("otp_required", resolve);
		});
		const otpPayload = await otpRequiredPromise;
		await otpPayload.submit(otp);
	}

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

	t.test("should complete the full end-to-end connection using untrusted (OTP) mode", async () => {
		await connectClients(dappClient, walletClient, "untrusted");

		t.expect((dappClient as any).state).toBe("CONNECTED");
		t.expect((walletClient as any).state).toBe("CONNECTED");

		const dappSessions = await dappSessionStore.list();
		const walletSessions = await walletSessionStore.list();
		t.expect(dappSessions).toHaveLength(1);
		t.expect(walletSessions).toHaveLength(1);
		t.expect(dappSessions[0].id).toEqual(walletSessions[0].id);
	});

	t.test("should complete the full end-to-end connection using trusted (no-OTP) mode", async () => {
		let otpDisplayed = false;
		walletClient.on("display_otp", () => {
			otpDisplayed = true;
		});
		let otpRequired = false;
		dappClient.on("otp_required", () => {
			otpRequired = true;
		});

		await connectClients(dappClient, walletClient, "trusted");

		t.expect(otpDisplayed, "Wallet should not display an OTP in trusted mode").toBe(false);
		t.expect(otpRequired, "DApp should not require an OTP in trusted mode").toBe(false);

		t.expect((dappClient as any).state).toBe("CONNECTED");
		t.expect((walletClient as any).state).toBe("CONNECTED");
	});

	t.test("should default to the untrusted connection flow", async () => {
		const sessionRequestPromise = new Promise<SessionRequest>((resolve) => {
			dappClient.on("session_request", resolve);
		});

		// Connect without specifying a mode
		dappClient.connect();

		const sessionRequest = await sessionRequestPromise;
		t.expect(sessionRequest.mode).toBe("untrusted");
	});

	t.test("should allow bidirectional messaging after an untrusted connection", async () => {
		await connectClients(dappClient, walletClient, "untrusted");

		const requestPayload = { method: "eth_accounts" };
		const messageFromDappPromise = new Promise((resolve) => walletClient.on("message", resolve));
		await dappClient.sendRequest(requestPayload);
		await t.expect(messageFromDappPromise).resolves.toEqual(requestPayload);

		const responsePayload = { result: ["0x123..."] };
		const messageFromWalletPromise = new Promise((resolve) => dappClient.on("message", resolve));
		await walletClient.sendResponse(responsePayload);
		await t.expect(messageFromWalletPromise).resolves.toEqual(responsePayload);
	});

	t.test("should allow bidirectional messaging after a trusted connection", async () => {
		await connectClients(dappClient, walletClient, "trusted");

		const requestPayload = { method: "eth_accounts_trusted" };
		const messageFromDappPromise = new Promise((resolve) => walletClient.on("message", resolve));
		await dappClient.sendRequest(requestPayload);
		await t.expect(messageFromDappPromise).resolves.toEqual(requestPayload);

		const responsePayload = { result: ["0x456..."] };
		const messageFromWalletPromise = new Promise((resolve) => dappClient.on("message", resolve));
		await walletClient.sendResponse(responsePayload);
		await t.expect(messageFromWalletPromise).resolves.toEqual(responsePayload);
	});

	t.test("should successfully resume a previously established session", async () => {
		await connectClients(dappClient, walletClient, "untrusted");
		const sessionId = (await dappSessionStore.list())[0].id;

		await (dappClient as any).transport.disconnect();
		await (walletClient as any).transport.disconnect();

		const newDappTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: dappKvStore, websocket: WebSocket });
		const newWalletTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: walletKvStore, websocket: WebSocket });
		const resumedDappClient = new DappClient({ transport: newDappTransport, sessionstore: dappSessionStore });
		const resumedWalletClient = new WalletClient({ transport: newWalletTransport, sessionstore: walletSessionStore });
		dappClient = resumedDappClient;
		walletClient = resumedWalletClient;

		await t.expect(resumedDappClient.resume(sessionId)).resolves.toBeUndefined();
		await t.expect(resumedWalletClient.resume(sessionId)).resolves.toBeUndefined();

		const testPayload = { message: "hello after resume" };
		const messagePromise = new Promise((resolve) => resumedWalletClient.on("message", resolve));
		await resumedDappClient.sendRequest(testPayload);
		await t.expect(messagePromise).resolves.toEqual(testPayload);
	});
});
