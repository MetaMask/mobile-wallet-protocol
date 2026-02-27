/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
/** biome-ignore-all lint/suspicious/noShadowRestrictedNames: test code */
import { type ConnectionMode, type IKeyManager, type IKVStore, type KeyPair, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { DappClient, type OtpRequiredPayload } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import { decrypt, encrypt, PrivateKey } from "eciesjs";
import { type Proxy, Toxiproxy } from "toxiproxy-node-client";
import * as t from "vitest";
import WebSocket from "ws";

const RELAY_URL = "ws://localhost:8000/connection/websocket";
const PROXY_RELAY_URL = "ws://localhost:8001/connection/websocket";
const TOXIPROXY_URL = "http://localhost:8474";

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

export class KeyManager implements IKeyManager {
	generateKeyPair(): KeyPair {
		const privateKey = new PrivateKey();
		return { privateKey: new Uint8Array(privateKey.secret), publicKey: privateKey.publicKey.toBytes(true) };
	}

	async encrypt(plaintext: string, theirPublicKey: Uint8Array): Promise<string> {
		const plaintextBuffer = Buffer.from(plaintext, "utf8");
		const encryptedBuffer = encrypt(theirPublicKey, plaintextBuffer);
		return encryptedBuffer.toString("base64");
	}

	async decrypt(encryptedB64: string, myPrivateKey: Uint8Array): Promise<string> {
		const encryptedBuffer = Buffer.from(encryptedB64, "base64");
		const decryptedBuffer = await decrypt(myPrivateKey, encryptedBuffer);
		return Buffer.from(decryptedBuffer).toString("utf8");
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

// Helper to assert that a promise does NOT resolve within a given time
async function assertPromiseNotResolve(promise: Promise<unknown>, timeout: number, message: string) {
	const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeout));
	await t.expect(Promise.race([promise, timeoutPromise])).rejects.toThrow(message);
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
		const keyManager = new KeyManager();

		dappClient = new DappClient({ transport: dappTransport, sessionstore: dappSessionStore, keymanager: keyManager });
		walletClient = new WalletClient({ transport: walletTransport, sessionstore: walletSessionStore, keymanager: keyManager });
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
		const keyManager = new KeyManager();
		const resumedDappClient = new DappClient({ transport: newDappTransport, sessionstore: dappSessionStore, keymanager: keyManager });
		const resumedWalletClient = new WalletClient({ transport: newWalletTransport, sessionstore: walletSessionStore, keymanager: keyManager });
		dappClient = resumedDappClient;
		walletClient = resumedWalletClient;

		await t.expect(resumedDappClient.resume(sessionId)).resolves.toBeUndefined();
		await t.expect(resumedWalletClient.resume(sessionId)).resolves.toBeUndefined();

		const testPayload = { message: "hello after resume" };
		const messagePromise = new Promise((resolve) => resumedWalletClient.on("message", resolve));
		await resumedDappClient.sendRequest(testPayload);
		await t.expect(messagePromise).resolves.toEqual(testPayload);
	});

	t.test("should discard inbound messages when the receiver's session has expired", async () => {
		await connectClients(dappClient, walletClient, "trusted");

		// Verify the connection works before expiry
		const preExpiryPayload = { method: "before_expiry" };
		const preExpiryPromise = new Promise((resolve) => walletClient.once("message", resolve));
		await dappClient.sendRequest(preExpiryPayload);
		await t.expect(preExpiryPromise).resolves.toEqual(preExpiryPayload);

		// Force-expire the wallet's session by setting expiresAt to the past
		(walletClient as any).session.expiresAt = Date.now() - 1000;

		// Listen for the SESSION_EXPIRED error on the wallet
		const errorPromise = new Promise<any>((resolve) => walletClient.once("error", resolve));

		// Dapp sends another message - wallet should reject it
		const postExpiryPayload = { method: "after_expiry" };
		await dappClient.sendRequest(postExpiryPayload);

		const error = await errorPromise;
		t.expect(error.code).toBe("SESSION_EXPIRED");

		// Give time for any message processing
		await new Promise((resolve) => setTimeout(resolve, 500));
	});
});

t.describe("E2E Integration Test via Proxy", () => {
	let dappClient: DappClient;
	let walletClient: WalletClient;
	let dappKvStore: InMemoryKVStore;
	let walletKvStore: InMemoryKVStore;
	let dappSessionStore: SessionStore;
	let walletSessionStore: SessionStore;

	// Toxiproxy setup
	let toxiproxy: Toxiproxy;
	let proxy: Proxy;
	const proxyConfig = {
		listen: "0.0.0.0:8001",
		upstream: "centrifugo:8000",
	};

	t.beforeAll(async () => {
		toxiproxy = new Toxiproxy(TOXIPROXY_URL);
		try {
			proxy = await toxiproxy.get("centrifugo_proxy");
			await proxy.remove();
		} catch {
			// Proxy doesn't exist, which is fine
		}
		proxy = await toxiproxy.createProxy({
			name: "centrifugo_proxy",
			...proxyConfig,
		});
	});

	t.beforeEach(async () => {
		// Ensure the proxy is enabled before each test
		await proxy.update({ ...proxyConfig, enabled: true });

		dappKvStore = new InMemoryKVStore();
		walletKvStore = new InMemoryKVStore();
		dappSessionStore = new SessionStore(dappKvStore);
		walletSessionStore = new SessionStore(walletKvStore);

		// DApp connects directly, Wallet connects through proxy
		const dappTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: dappKvStore, websocket: WebSocket });
		const walletTransport = await WebSocketTransport.create({ url: PROXY_RELAY_URL, kvstore: walletKvStore, websocket: WebSocket });
		const keyManager = new KeyManager();

		dappClient = new DappClient({ transport: dappTransport, sessionstore: dappSessionStore, keymanager: keyManager });
		walletClient = new WalletClient({ transport: walletTransport, sessionstore: walletSessionStore, keymanager: keyManager });
	});

	t.afterEach(async () => {
		// Reset proxy state after each test
		if (proxy) {
			await proxy.update({ ...proxyConfig, enabled: true });
		}
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

	t.test(
		"should recover from a one-sided stale connection and receive queued messages after reconnect",
		async () => {
			// 1. Establish a normal connection and exchange a message to confirm it works
			await connectClients(dappClient, walletClient, "trusted");
			const initialMessage = { step: "initial_message" };
			const initialMessagePromise = new Promise((resolve) => walletClient.once("message", resolve));
			await dappClient.sendRequest(initialMessage);
			await t.expect(initialMessagePromise).resolves.toEqual(initialMessage);
			t.expect((walletClient as any).state).toBe("CONNECTED");

			// 2. Create a ONE-SIDED network partition using toxiproxy.
			// This cuts off the Wallet's connection but leaves the DApp's connection intact.
			await proxy.update({ ...proxyConfig, enabled: false });

			// 3. Dapp sends a message. Its transport is still live, so it successfully publishes to the relay.
			// The Wallet, however, is now on a stale connection and should NOT receive it.
			const missedMessage = { step: "missed_message" };
			const missedMessagePromise = new Promise((resolve) => walletClient.once("message", resolve));
			await dappClient.sendRequest(missedMessage);

			// Assert that the message is NOT received by the wallet within 2 seconds.
			await assertPromiseNotResolve(missedMessagePromise, 2000, "Wallet incorrectly received message during network partition.");

			// 4. Restore the network path and trigger the wallet's reconnect logic.
			await proxy.update({ ...proxyConfig, enabled: true });
			await walletClient.reconnect();

			// 5. The wallet should now re-establish its connection. The transport's recovery logic
			// should fetch the missed message from the channel's history.
			const receivedMissedMessage = await missedMessagePromise;
			t.expect(receivedMissedMessage).toEqual(missedMessage);
			t.expect((walletClient as any).state).toBe("CONNECTED");

			// 6. Send a final message to confirm the live connection is fully restored and working.
			const finalMessage = { step: "final_message" };
			const finalMessagePromise = new Promise((resolve) => walletClient.once("message", resolve));
			await dappClient.sendRequest(finalMessage);
			await t.expect(finalMessagePromise).resolves.toEqual(finalMessage);
		},
		15000,
	);
});
