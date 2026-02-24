/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import { type IKeyManager, type IKVStore, type KeyPair, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { decrypt, encrypt, PrivateKey } from "eciesjs";
import * as t from "vitest";
import WebSocket from "ws";
import { DappClient } from "./client";

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

t.describe("DappClient Integration Tests", () => {
	let dappClient: DappClient;

	t.beforeEach(async () => {
		const dappKvStore = new InMemoryKVStore();
		const dappSessionStore = await SessionStore.create(dappKvStore);
		const dappTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: dappKvStore, websocket: WebSocket });
		dappClient = new DappClient({ transport: dappTransport, sessionstore: dappSessionStore, keymanager: new KeyManager() });
	});

	t.afterEach(async () => {
		await dappClient.disconnect();
	});

	t.describe("Connection Modes", () => {
		t.test("should emit a 'session_request' with 'untrusted' mode by default", async () => {
			const sessionRequestPromise = new Promise<SessionRequest>((resolve) => {
				dappClient.on("session_request", resolve);
			});

			dappClient.connect(); // Don't await, no options provided

			const request = await sessionRequestPromise;
			t.expect(request.mode).toBe("untrusted");
			t.expect(request.initialMessage).toBeUndefined();
		});

		t.test("should emit a 'session_request' with 'trusted' mode when specified", async () => {
			const sessionRequestPromise = new Promise<SessionRequest>((resolve) => {
				dappClient.on("session_request", resolve);
			});

			dappClient.connect({ mode: "trusted" }); // Don't await

			const request = await sessionRequestPromise;
			t.expect(request.mode).toBe("trusted");
			t.expect(request.initialMessage).toBeUndefined();
		});

		t.test("should emit a 'session_request' with a valid initialPayload", async () => {
			const sessionRequestPromise = new Promise<SessionRequest>((resolve) => {
				dappClient.on("session_request", resolve);
			});

			const initialPayload = { jsonrpc: "2.0", method: "eth_requestAccounts", params: [] };
			dappClient.connect({ initialPayload }); // Don't await

			const request = await sessionRequestPromise;
			const expectedMessage = { type: "message", payload: initialPayload };
			t.expect(request.initialMessage).toEqual(expectedMessage);
		});
	});

	t.describe("Untrusted Flow", () => {
		t.test("should fail if handshake-offer is not received in time", async () => {
			const shortTimeoutDappClient = new DappClient({
				transport: (dappClient as any).transport,
				sessionstore: (dappClient as any).sessionstore,
				keymanager: new KeyManager(),
			});

			const originalMethod = (shortTimeoutDappClient as any)._createPendingSessionAndRequest;
			(shortTimeoutDappClient as any)._createPendingSessionAndRequest = function () {
				const result = originalMethod.call(this, "untrusted");
				result.request.expiresAt = Date.now() + 10;
				return result;
			};

			const connectPromise = shortTimeoutDappClient.connect({ mode: "untrusted" });

			await t.expect(connectPromise).rejects.toThrow(/(?:Did not receive handshake offer|Session request expired before wallet could connect)/);

			await shortTimeoutDappClient.disconnect();
		});
	});

	t.describe("General Functionality", () => {
		t.test("sendRequest() should fail if not connected", async () => {
			await t.expect(dappClient.sendRequest({ method: "test" })).rejects.toThrow("Cannot send request: not connected.");
		});

		t.test("should have correct initial state", async () => {
			t.expect((dappClient as any).state).toBe("DISCONNECTED");
		});
	});
});
