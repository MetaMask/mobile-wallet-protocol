import { v4 as uuidv4 } from "uuid";
import { beforeEach, describe, expect, test } from "vitest";
import { IKVStore } from "../domain/kv-store";
import { WebSocketTransportStorage } from "./websocket";

// A mock IKVStore for testing purposes.
class MockKVStore extends IKVStore {
	private store = new Map<string, string>();

	get(key: string): Promise<string | null> {
		return Promise.resolve(this.store.get(this.prefix(key)) ?? null);
	}

	set(key: string, value: string): Promise<void> {
		this.store.set(this.prefix(key), value);
		return Promise.resolve();
	}

	remove(key: string): Promise<void> {
		this.store.delete(this.prefix(key));
		return Promise.resolve();
	}

	// This is not part of IKVStore, but needed for tests to inspect state
	getRaw(key: string): string | undefined {
		return this.store.get(key);
	}

	protected prefix(key: string): string {
		return `test-prefix:${key}`;
	}
}

describe("WebSocketTransportStorage", () => {
	let kvstore: MockKVStore;
	let storage: WebSocketTransportStorage;

	beforeEach(async () => {
		kvstore = new MockKVStore();
		storage = await WebSocketTransportStorage.create(kvstore);
	});

	describe("create", () => {
		test("should create a new client ID if one does not exist", async () => {
			const clientId = storage.getClientId();
			expect(clientId).toBeDefined();
			const storedClientId = await kvstore.get("websocket-transport-client-id");
			expect(storedClientId).toBe(clientId);
		});

		test("should retrieve an existing client ID if it exists", async () => {
			const existingClientId = uuidv4();
			const newKvStore = new MockKVStore();
			await newKvStore.set("websocket-transport-client-id", existingClientId);
			const newStorage = await WebSocketTransportStorage.create(newKvStore);
			expect(newStorage.getClientId()).toBe(existingClientId);
		});
	});

	describe("getClientId", () => {
		test("should return the client ID", () => {
			const clientId = storage.getClientId();
			expect(typeof clientId).toBe("string");
			expect(clientId.length).toBeGreaterThan(0);
		});
	});

	describe("getNextNonce", () => {
		test("should initialize nonce to 1 if it does not exist", () => {
			const nonce = storage.getNextNonce();
			expect(nonce).toBe(1);
		});

		test("should increment the nonce from its previous value", () => {
			storage.getNextNonce(); // 1
			storage.getNextNonce(); // 2
			const nonce = storage.getNextNonce(); // 3
			expect(nonce).toBe(3);
		});
	});

	describe("getLatestNonces and setLatestNonces", () => {
		test("should return an empty map if no nonces are stored for a channel", async () => {
			const nonces = await storage.getLatestNonces("channel-1");
			expect(nonces).toBeInstanceOf(Map);
			expect(nonces.size).toBe(0);
		});

		test("should store and retrieve the latest nonces for a channel", async () => {
			const channel = "channel-2";
			const noncesToSet = new Map<string, number>();
			noncesToSet.set("client-a", 100);
			noncesToSet.set("client-b", 200);

			await storage.setLatestNonces(channel, noncesToSet);
			const retrievedNonces = await storage.getLatestNonces(channel);

			expect(retrievedNonces).toEqual(noncesToSet);
		});

		test("should handle serialization and deserialization correctly", async () => {
			const channel = "channel-3";
			const noncesToSet = new Map([
				["client-x", 99],
				["client-y", 101],
			]);

			await storage.setLatestNonces(channel, noncesToSet);

			const clientId = storage.getClientId();
			const rawKey = `test-prefix:latestNonces_${clientId}_${channel}`;
			const rawValue = kvstore.getRaw(rawKey);
			expect(rawValue).toBe(JSON.stringify(Object.fromEntries(noncesToSet)));

			const retrievedNonces = await storage.getLatestNonces(channel);
			expect(retrievedNonces.get("client-x")).toBe(99);
			expect(retrievedNonces.get("client-y")).toBe(101);
		});
	});
});
