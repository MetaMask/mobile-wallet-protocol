/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
/** biome-ignore-all lint/complexity/useLiteralKeys: test code */
import { v4 as uuid } from "uuid";
import * as t from "vitest";
import WebSocket from "ws";
import { BaseClient } from "./base-client";
import type { IKVStore } from "./domain/kv-store";
import type { ProtocolMessage } from "./domain/protocol-message";
import type { Session } from "./domain/session";
import { KeyManager } from "./key-manager";
import { SessionStore } from "./session-store";
import { WebSocketTransport } from "./transport/websocket";

const WEBSOCKET_URL = "ws://localhost:8000/connection/websocket";

class InMemoryKVStore implements IKVStore {
	private store = new Map<string, string>();

	public async get(key: string): Promise<string | null> {
		return this.store.get(key) || null;
	}

	public async set(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	public async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	public async list(): Promise<string[]> {
		return Array.from(this.store.keys());
	}
}

class TestClient extends BaseClient {
	public receivedMessages: ProtocolMessage[] = [];

	// The required implementation of the abstract method.
	// We'll just store the messages to assert against them later.
	protected handleMessage(message: ProtocolMessage): void {
		this.receivedMessages.push(message);
	}

	// Helper to expose the session for assertions.
	public getSession(): Session | null {
		return this.session;
	}

	// Helper to manually set the session, simulating a completed handshake.
	public setSession(session: Session) {
		this.session = session;
	}

	// Expose the protected sendMessage for easier testing.
	public sendMessage(message: ProtocolMessage): Promise<void> {
		return super.sendMessage(message);
	}
}

// Helper to wait for an async event.
const waitFor = (client: TestClient, event: string): Promise<any> => {
	return new Promise((resolve) => client.once(event, resolve));
};

t.describe("BaseClient", () => {
	let clientA: TestClient;
	let clientB: TestClient;
	let sessionStoreA: SessionStore;
	let sessionStoreB: SessionStore;
	const channel = `session:${uuid()}`;

	t.beforeEach(async () => {
		const kvstoreA = new InMemoryKVStore();
		const kvstoreB = new InMemoryKVStore();

		sessionStoreA = new SessionStore(kvstoreA);
		sessionStoreB = new SessionStore(kvstoreB);

		const transportA = await WebSocketTransport.create({ url: WEBSOCKET_URL, kvstore: kvstoreA, websocket: WebSocket });
		const transportB = await WebSocketTransport.create({ url: WEBSOCKET_URL, kvstore: kvstoreB, websocket: WebSocket });

		clientA = new TestClient(transportA, new KeyManager(), sessionStoreA);
		clientB = new TestClient(transportB, new KeyManager(), sessionStoreB);

		// Connect both clients to the relay server
		await Promise.all([clientA["transport"].connect(), clientB["transport"].connect()]);
	});

	t.afterEach(async () => {
		await Promise.all([clientA.disconnect(), clientB.disconnect()]);
		t.vi.clearAllMocks();
	});

	t.test("should send and receive an encrypted message between two clients", async () => {
		// 1. Simulate a shared session between the two clients
		const keyManagerA = new KeyManager();
		const keyManagerB = new KeyManager();
		const keyPairA = keyManagerA.generateKeyPair();
		const keyPairB = keyManagerB.generateKeyPair();

		const sessionA: Session = {
			id: "session-ab",
			channel,
			keyPair: keyPairA,
			theirPublicKey: keyPairB.publicKey,
			expiresAt: Date.now() + 60000,
		};
		const sessionB: Session = {
			id: "session-ab", // Same session ID
			channel,
			keyPair: keyPairB,
			theirPublicKey: keyPairA.publicKey,
			expiresAt: Date.now() + 60000,
		};

		clientA.setSession(sessionA);
		clientB.setSession(sessionB);

		// 2. Subscribe both clients to the shared channel
		await clientA["transport"].subscribe(channel);
		await clientB["transport"].subscribe(channel);

		// 3. Client A sends a message
		const messageToSend: ProtocolMessage = { type: "dapp-request", payload: { method: "eth_sendTransaction" } };
		await clientA.sendMessage(messageToSend);

		// 4. Wait for Client B to receive and process the message
		await new Promise((resolve) => {
			const interval = setInterval(() => {
				if (clientB.receivedMessages.length > 0) {
					clearInterval(interval);
					resolve(true);
				}
			}, 50);
		});

		// 5. Assert that Client B received the correct, decrypted message
		t.expect(clientB.receivedMessages).toHaveLength(1);
		t.expect(clientB.receivedMessages[0]).toEqual(messageToSend);
		// and that Client A did not receive its own message
		t.expect(clientA.receivedMessages).toHaveLength(0);
	});

	t.test("disconnect should clear transport, delete session, and emit event", async () => {
		const session: Session = {
			id: "session-to-disconnect",
			channel,
			keyPair: new KeyManager().generateKeyPair(),
			theirPublicKey: new Uint8Array(33),
			expiresAt: Date.now() + 60000,
		};

		await sessionStoreA.set(session);
		clientA.setSession(session);

		const transportClearSpy = t.vi.spyOn(clientA["transport"], "clear");
		const sessionDeleteSpy = t.vi.spyOn(clientA["sessionstore"], "delete");
		const disconnectedEventPromise = waitFor(clientA, "disconnected");

		t.expect(await sessionStoreA.list()).toHaveLength(1);

		await clientA.disconnect();

		t.expect(transportClearSpy).toHaveBeenCalledWith(channel);
		t.expect(sessionDeleteSpy).toHaveBeenCalledWith(session.id);
		t.expect(clientA.getSession()).toBeNull();
		await t.expect(disconnectedEventPromise).resolves.toBeUndefined(); // a resolved promise means the event fired
		t.expect(await sessionStoreA.list()).toHaveLength(0);
	});
});
