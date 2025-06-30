import { v4 as uuid } from "uuid";
import * as t from "vitest";
import type { IKVStore } from "../../domain/kv-store";
import { WebSocketTransportStorage } from "./store";

/**
 * Simple in-memory KV store implementation for testing.
 */
class InMemoryKVStore implements IKVStore {
	private store = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		return this.store.get(key) || null;
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async remove(key: string): Promise<void> {
		this.store.delete(key);
	}

	// Helper methods for testing
	getAllKeys(): string[] {
		return Array.from(this.store.keys());
	}

	clear(): void {
		this.store.clear();
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
			t.expect(await kvstore.get("websocket-transport-client-id")).toBe(clientId);
		});

		t.test("should reuse existing client ID from storage", async () => {
			const existingClientId = uuid();
			await kvstore.set("websocket-transport-client-id", existingClientId);

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
		let clientId: string;

		t.beforeEach(async () => {
			storage = await WebSocketTransportStorage.create(kvstore);
			clientId = storage.getClientId();
		});

		t.test("should start nonces at 1 for new channels", async () => {
			const channel = "session:test-channel";
			const nonce = await storage.getNextNonce(channel);

			t.expect(nonce).toBe(1);
			t.expect(await kvstore.get(`nonce:${clientId}:${channel}`)).toBe("1");
		});

		t.test("should increment nonces for subsequent calls on same channel", async () => {
			const channel = "session:test-channel";

			const nonce1 = await storage.getNextNonce(channel);
			const nonce2 = await storage.getNextNonce(channel);
			const nonce3 = await storage.getNextNonce(channel);

			t.expect(nonce1).toBe(1);
			t.expect(nonce2).toBe(2);
			t.expect(nonce3).toBe(3);
			t.expect(await kvstore.get(`nonce:${clientId}:${channel}`)).toBe("3");
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

			t.expect(await kvstore.get(`nonce:${clientId}:${channelA}`)).toBe("2");
			t.expect(await kvstore.get(`nonce:${clientId}:${channelB}`)).toBe("2");
		});

		t.test("should restore nonce state from storage", async () => {
			const channel = "session:test-channel";

			// Set initial nonce state
			await kvstore.set(`nonce:${clientId}:${channel}`, "5");

			// Create new storage instance with same kvstore
			const newStorage = await WebSocketTransportStorage.create(kvstore);
			const nextNonce = await newStorage.getNextNonce(channel);

			t.expect(nextNonce).toBe(6);
			t.expect(await kvstore.get(`nonce:${clientId}:${channel}`)).toBe("6");
		});
	});

	t.describe("Latest Nonces Management", () => {
		let storage: WebSocketTransportStorage;
		let clientId: string;

		t.beforeEach(async () => {
			storage = await WebSocketTransportStorage.create(kvstore);
			clientId = storage.getClientId();
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
		let clientId: string;

		t.beforeEach(async () => {
			storage = await WebSocketTransportStorage.create(kvstore);
			clientId = storage.getClientId();
		});

		t.test("should remove all channel-specific keys on cleanup", async () => {
			const channel = "session:test-channel";

			// Create some data for the channel
			await storage.getNextNonce(channel); // Creates nonce key
			await storage.setLatestNonces(channel, new Map([["client-1", 5]])); // Creates latest nonces key

			// Verify keys exist
			t.expect(await kvstore.get(`nonce:${clientId}:${channel}`)).toBe("1");
			t.expect(await kvstore.get(`latest-nonces:${clientId}:${channel}`)).toBeTruthy();

			// Cleanup
			await storage.cleanupChannel(channel);

			// Verify keys are removed
			t.expect(await kvstore.get(`nonce:${clientId}:${channel}`)).toBeNull();
			t.expect(await kvstore.get(`latest-nonces:${clientId}:${channel}`)).toBeNull();

			// Verify client ID key is not affected
			t.expect(await kvstore.get("websocket-transport-client-id")).toBe(clientId);
		});

		t.test("should not error when cleaning up non-existent channel", async () => {
			const channel = "session:non-existent";

			await t.expect(storage.cleanupChannel(channel)).resolves.toBeUndefined();
		});
	});

	t.describe("Multiple Storage Instances", () => {
		t.test("should work correctly with multiple storage instances sharing same kvstore", async () => {
			const storage1 = await WebSocketTransportStorage.create(kvstore);
			const storage2 = await WebSocketTransportStorage.create(kvstore);

			// Both should have the same client ID
			t.expect(storage1.getClientId()).toBe(storage2.getClientId());

			const channel = "session:shared-channel";

			// Get nonces from both instances
			const nonce1 = await storage1.getNextNonce(channel);
			const nonce2 = await storage2.getNextNonce(channel);

			// Should continue the sequence
			t.expect(nonce1).toBe(1);
			t.expect(nonce2).toBe(2);

			// Both should see the same latest nonces
			const nonces = new Map([["other-client", 10]]);
			await storage1.setLatestNonces(channel, nonces);

			const retrievedByStorage2 = await storage2.getLatestNonces(channel);
			t.expect(retrievedByStorage2).toEqual(nonces);
		});
	});
});
