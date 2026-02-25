import { v4 as uuid } from "uuid";
import * as t from "vitest";
import type { IKVStore } from "../../domain/kv-store";
import { WebSocketTransportStorage } from "./store";

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

t.describe("WebSocketTransportStorage", () => {
	let kvstore: InMemoryKVStore;

	t.beforeEach(() => {
		kvstore = new InMemoryKVStore();
	});

	t.describe("Client ID Management", () => {
		t.test("should generate and persist a new client ID when none exists", async () => {
			const storage = await WebSocketTransportStorage.create(kvstore);
			const clientId = storage.getClientId();

			t.expect(clientId).toBeTruthy();
			t.expect(typeof clientId).toBe("string");
			t.expect(await kvstore.get(WebSocketTransportStorage.getClientIdKey())).toBe(clientId);
		});

		t.test("should reuse existing client ID from storage", async () => {
			const existingClientId = uuid();
			await kvstore.set(WebSocketTransportStorage.getClientIdKey(), existingClientId);

			const storage = await WebSocketTransportStorage.create(kvstore);
			const clientId = storage.getClientId();

			t.expect(clientId).toBe(existingClientId);
		});

		t.test("should return the same client ID across multiple instances with same kvstore", async () => {
			const storage1 = await WebSocketTransportStorage.create(kvstore);
			const clientId1 = storage1.getClientId();

			const storage2 = await WebSocketTransportStorage.create(kvstore);
			const clientId2 = storage2.getClientId();

			t.expect(clientId1).toBe(clientId2);
		});
	});

	t.describe("Nonce Management", () => {
		let storage: WebSocketTransportStorage;

		t.beforeEach(async () => {
			storage = await WebSocketTransportStorage.create(kvstore);
		});

		t.test("should start nonces at 1 for new channels", async () => {
			const channel = "session:test-channel";
			const nonce = await storage.getNextNonce(channel);

			t.expect(nonce).toBe(1);
			t.expect(await kvstore.get(storage.getNonceKey(channel))).toBe("1");
		});

		t.test("should increment nonces for subsequent calls on same channel", async () => {
			const channel = "session:test-channel";

			const nonce1 = await storage.getNextNonce(channel);
			const nonce2 = await storage.getNextNonce(channel);
			const nonce3 = await storage.getNextNonce(channel);

			t.expect(nonce1).toBe(1);
			t.expect(nonce2).toBe(2);
			t.expect(nonce3).toBe(3);
			t.expect(await kvstore.get(storage.getNonceKey(channel))).toBe("3");
		});

		t.test("should maintain independent nonces per channel", async () => {
			const channelA = "session:channel-a";
			const channelB = "session:channel-b";

			const nonceA1 = await storage.getNextNonce(channelA);
			const nonceB1 = await storage.getNextNonce(channelB);
			const nonceA2 = await storage.getNextNonce(channelA);
			const nonceB2 = await storage.getNextNonce(channelB);

			t.expect(nonceA1).toBe(1);
			t.expect(nonceB1).toBe(1);
			t.expect(nonceA2).toBe(2);
			t.expect(nonceB2).toBe(2);

			t.expect(await kvstore.get(storage.getNonceKey(channelA))).toBe("2");
			t.expect(await kvstore.get(storage.getNonceKey(channelB))).toBe("2");
		});

		t.test("should restore nonce state from storage", async () => {
			const channel = "session:test-channel";

			// Set initial nonce state
			await kvstore.set(storage.getNonceKey(channel), "5");

			// Create new storage instance with same kvstore
			const newStorage = await WebSocketTransportStorage.create(kvstore);
			const nextNonce = await newStorage.getNextNonce(channel);

			t.expect(nextNonce).toBe(6);
			t.expect(await kvstore.get(newStorage.getNonceKey(channel))).toBe("6");
		});

		t.test("should recover from NaN nonce value in storage", async () => {
			const channel = "session:nan-channel";

			// Corrupt the stored nonce value
			await kvstore.set(storage.getNonceKey(channel), "not-a-number");

			const nonce = await storage.getNextNonce(channel);
			t.expect(nonce).toBe(1);
			t.expect(await kvstore.get(storage.getNonceKey(channel))).toBe("1");
		});
	});

	t.describe("Nonce Confirmation", () => {
		let storage: WebSocketTransportStorage;

		t.beforeEach(async () => {
			storage = await WebSocketTransportStorage.create(kvstore);
		});

		t.test("should save nonce via confirmNonce", async () => {
			const channel = "session:confirm-channel";
			await storage.confirmNonce(channel, "sender-1", 5);

			const nonces = await storage.getLatestNonces(channel);
			t.expect(nonces.get("sender-1")).toBe(5);
		});

		t.test("should not regress nonce on confirmNonce with lower value", async () => {
			const channel = "session:confirm-channel";
			await storage.confirmNonce(channel, "sender-1", 10);
			await storage.confirmNonce(channel, "sender-1", 3);

			const nonces = await storage.getLatestNonces(channel);
			t.expect(nonces.get("sender-1")).toBe(10);
		});

		t.test("should track nonces independently per sender", async () => {
			const channel = "session:confirm-channel";
			await storage.confirmNonce(channel, "sender-1", 5);
			await storage.confirmNonce(channel, "sender-2", 8);

			const nonces = await storage.getLatestNonces(channel);
			t.expect(nonces.get("sender-1")).toBe(5);
			t.expect(nonces.get("sender-2")).toBe(8);
		});
	});

	t.describe("Latest Nonces Management", () => {
		let storage: WebSocketTransportStorage;

		t.beforeEach(async () => {
			storage = await WebSocketTransportStorage.create(kvstore);
		});

		t.test("should return empty map for channels with no latest nonces", async () => {
			const channel = "session:test-channel";
			const latestNonces = await storage.getLatestNonces(channel);

			t.expect(latestNonces).toBeInstanceOf(Map);
			t.expect(latestNonces.size).toBe(0);
		});

		t.test("should store and retrieve latest nonces", async () => {
			const channel = "session:test-channel";
			const nonces = new Map([
				["client-1", 5],
				["client-2", 3],
				["client-3", 10],
			]);

			await storage.setLatestNonces(channel, nonces);
			const retrieved = await storage.getLatestNonces(channel);

			t.expect(retrieved).toEqual(nonces);
		});

		t.test("should update existing latest nonces", async () => {
			const channel = "session:test-channel";

			// Set initial nonces
			const initialNonces = new Map([
				["client-1", 5],
				["client-2", 3],
			]);
			await storage.setLatestNonces(channel, initialNonces);

			// Update with new values
			const updatedNonces = new Map([
				["client-1", 8],
				["client-2", 3],
				["client-3", 2],
			]);
			await storage.setLatestNonces(channel, updatedNonces);

			const retrieved = await storage.getLatestNonces(channel);
			t.expect(retrieved).toEqual(updatedNonces);
		});

		t.test("should maintain independent latest nonces per channel", async () => {
			const channelA = "session:channel-a";
			const channelB = "session:channel-b";

			const noncesA = new Map([
				["client-1", 5],
				["client-2", 3],
			]);
			const noncesB = new Map([
				["client-1", 2],
				["client-3", 7],
			]);

			await storage.setLatestNonces(channelA, noncesA);
			await storage.setLatestNonces(channelB, noncesB);

			const retrievedA = await storage.getLatestNonces(channelA);
			const retrievedB = await storage.getLatestNonces(channelB);

			t.expect(retrievedA).toEqual(noncesA);
			t.expect(retrievedB).toEqual(noncesB);
		});
	});

	t.describe("Cleanup", () => {
		let storage: WebSocketTransportStorage;

		t.beforeEach(async () => {
			storage = await WebSocketTransportStorage.create(kvstore);
		});

		t.test("should clear all storage for a channel", async () => {
			const channel = "session:test-channel";

			// Set up some nonce data
			await storage.getNextNonce(channel);
			await storage.getNextNonce(channel);
			await storage.getNextNonce(channel);

			// Set up some latest nonces data
			const latestNonces = new Map([
				["client-1", 5],
				["client-2", 3],
			]);
			await storage.setLatestNonces(channel, latestNonces);

			// Verify data exists
			t.expect(await kvstore.get(storage.getNonceKey(channel))).toBe("3");
			t.expect(await storage.getLatestNonces(channel)).toEqual(latestNonces);

			// Clear the channel
			await storage.clear(channel);

			// Verify data is cleared
			t.expect(await kvstore.get(storage.getNonceKey(channel))).toBeNull();
			t.expect(await kvstore.get(storage.getLatestNoncesKey(channel))).toBeNull();
			t.expect(await storage.getLatestNonces(channel)).toEqual(new Map());
		});

		t.test("should clear only the specified channel, leaving others intact", async () => {
			const channelA = "session:channel-a";
			const channelB = "session:channel-b";

			// Set up data for both channels
			await storage.getNextNonce(channelA);
			await storage.getNextNonce(channelB);
			await storage.getNextNonce(channelB);

			const noncesA = new Map([["client-1", 5]]);
			const noncesB = new Map([["client-2", 3]]);
			await storage.setLatestNonces(channelA, noncesA);
			await storage.setLatestNonces(channelB, noncesB);

			// Clear only channel A
			await storage.clear(channelA);

			// Verify channel A is cleared
			t.expect(await kvstore.get(storage.getNonceKey(channelA))).toBeNull();
			t.expect(await kvstore.get(storage.getLatestNoncesKey(channelA))).toBeNull();

			// Verify channel B remains intact
			t.expect(await kvstore.get(storage.getNonceKey(channelB))).toBe("2");
			t.expect(await storage.getLatestNonces(channelB)).toEqual(noncesB);
		});

		t.test("should handle clearing non-existent channel gracefully", async () => {
			const channel = "session:non-existent-channel";

			// This should not throw an error
			await t.expect(storage.clear(channel)).resolves.toBeUndefined();
		});

		t.test("should handle clearing channel with partial data", async () => {
			const channel = "session:partial-channel";

			// Only set nonce data, no latest nonces
			await storage.getNextNonce(channel);

			// Clear should work even with partial data
			await t.expect(storage.clear(channel)).resolves.toBeUndefined();

			// Verify data is cleared
			t.expect(await kvstore.get(storage.getNonceKey(channel))).toBeNull();
			t.expect(await kvstore.get(storage.getLatestNoncesKey(channel))).toBeNull();
		});
	});
});
