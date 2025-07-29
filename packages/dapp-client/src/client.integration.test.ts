import { type IKVStore, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
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

t.describe("DappClient Integration Tests", () => {
	let dappClient: DappClient;

	t.beforeEach(async () => {
		const dappKvStore = new InMemoryKVStore();
		const dappSessionStore = new SessionStore(dappKvStore);
		const dappTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: dappKvStore, websocket: WebSocket });
		dappClient = new DappClient({ transport: dappTransport, sessionstore: dappSessionStore });
	});

	t.afterEach(async () => {
		await dappClient.disconnect();
	});

	t.test("connect() should emit a valid 'session_request'", async () => {
		const sessionRequestPromise = new Promise<SessionRequest>((resolve) => {
			dappClient.on("session_request", resolve);
		});

		dappClient.connect(); // Don't await

		const request = await sessionRequestPromise;
		t.expect(request.id).toBeTypeOf("string");
		t.expect(request.channel).toContain("handshake:");
		t.expect(request.publicKeyB64).toBeTypeOf("string");
		t.expect(request.expiresAt).toBeGreaterThan(Date.now());
	});

	t.test("connect() should fail if handshake-offer is not received in time", async () => {
		// Create a dapp client with shorter timeout for testing
		const shortTimeoutDappClient = new DappClient({
			// @ts-expect-error - accessing private property for testing
			transport: dappClient.transport,
			// @ts-expect-error - accessing private property for testing
			sessionstore: dappClient.sessionstore,
		});

		// Override the session request TTL for this test
		// @ts-expect-error - accessing private method for testing
		const originalMethod = shortTimeoutDappClient.createPendingSessionAndRequest;

		// @ts-expect-error - accessing private method for testing
		shortTimeoutDappClient.createPendingSessionAndRequest = function () {
			const result = originalMethod.call(this);
			result.request.expiresAt = Date.now() + 10; // Set a much shorter expiry (10ms instead of 60 seconds)
			return result;
		};

		const connectPromise = shortTimeoutDappClient.connect();
		// No wallet responds...

		// Both error messages are valid for REQUEST_EXPIRED scenario
		await t.expect(connectPromise).rejects.toThrow(/(?:Session request expired before wallet could connect\.|Did not receive handshake offer from wallet in time\.)/);

		await shortTimeoutDappClient.disconnect();
	});

	t.test("sendRequest() should fail if not connected", async () => {
		await t.expect(dappClient.sendRequest({ method: "test" })).rejects.toThrow("Cannot send request: not connected.");
	});

	t.test("should have correct initial state", async () => {
		// @ts-expect-error - accessing private property for testing
		t.expect(dappClient.state).toBe("DISCONNECTED");
	});

	t.test("disconnect() should clean up properly", async () => {
		await dappClient.disconnect();
		// @ts-expect-error - accessing private property for testing
		t.expect(dappClient.state).toBe("DISCONNECTED");
	});
});
