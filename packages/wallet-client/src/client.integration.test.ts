import { KeyManager, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { InMemoryKVStore } from "@metamask/mobile-wallet-protocol-core/storage/in-memory";
import { fromUint8Array } from "js-base64";
import * as t from "vitest";
import WebSocket from "ws";
import { WalletClient } from "./client";

const RELAY_URL = "ws://localhost:8000/connection/websocket";

t.describe("WalletClient Integration Tests", () => {
	let walletClient: WalletClient;
	let sessionRequest: SessionRequest;

	t.beforeEach(async () => {
		const walletKvStore = new InMemoryKVStore();
		const walletSessionStore = new SessionStore(walletKvStore);
		const walletTransport = await WebSocketTransport.create({ url: RELAY_URL, kvstore: walletKvStore, websocket: WebSocket });
		walletClient = new WalletClient({ transport: walletTransport, sessionstore: walletSessionStore });

		const dappKeyPair = new KeyManager().generateKeyPair();
		sessionRequest = {
			id: "test-session",
			channel: "handshake:test-session",
			publicKeyB64: fromUint8Array(dappKeyPair.publicKey),
			expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes from now
		};
	});

	t.afterEach(async () => {
		await walletClient.disconnect();
	});

	t.test("connect() should throw error if SessionRequest is expired", async () => {
		const expiredRequest = { ...sessionRequest, expiresAt: Date.now() - 1000 };
		await t.expect(walletClient.connect({ sessionRequest: expiredRequest })).rejects.toThrow("Session request expired");
	});

	t.test("sendResponse() should fail if not connected", async () => {
		await t.expect(walletClient.sendResponse({ result: "test" })).rejects.toThrow("Cannot send response: not connected.");
	});

	t.test("should have correct initial state", async () => {
		// @ts-expect-error - accessing private property for testing
		t.expect(walletClient.state).toBe("DISCONNECTED");
	});

	t.test("disconnect() should clean up properly", async () => {
		await walletClient.disconnect();
		// @ts-expect-error - accessing private property for testing
		t.expect(walletClient.state).toBe("DISCONNECTED");
	});
});
