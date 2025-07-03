/** biome-ignore-all lint/complexity/useLiteralKeys: test code */
/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import * as t from "vitest";
import type { IKVStore } from "../domain/kv-store";
import type { Session } from "../domain/session";
import { SessionStore } from "./index";

class MockKVStore implements IKVStore {
	private readonly store = new Map<string, string>();

	async set(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	async list(): Promise<string[]> {
		return Array.from(this.store.keys());
	}
}

t.describe("SessionStore", () => {
	let sessionstore: SessionStore;
	let kvstore: IKVStore;

	// Helper function to create a dummy session
	const createSession = (id: string, expiresAt: number): Session => ({
		id,
		channel: "test-channel",
		keyPair: {
			publicKey: new Uint8Array(33).fill(1),
			privateKey: new Uint8Array(32).fill(1),
		},
		theirPublicKey: new Uint8Array(33).fill(2),
		expiresAt,
	});

	t.beforeEach(() => {
		kvstore = new MockKVStore();
		sessionstore = new SessionStore(kvstore);
	});

	t.test("should set and get a session", async () => {
		const session = createSession("1", Date.now() + 10000);
		await sessionstore.set(session);
		const retrieved = await sessionstore.get("1");
		t.expect(retrieved).toEqual(session);
	});

	t.test("should return null for a non-existent session", async () => {
		const retrieved = await sessionstore.get("non-existent");
		t.expect(retrieved).toBeNull();
	});

	t.test("should throw an error when setting an expired session", async () => {
		const session = createSession("2", Date.now() - 1000);
		await t.expect(sessionstore.set(session)).rejects.toThrow("Cannot save expired session");
	});

	t.test("should return null and delete an expired session on get", async () => {
		const session = createSession("3", Date.now() - 1000);
		// Manually set an expired session for testing purposes
		const key = `session:${session.id}`;
		await kvstore.set(key, JSON.stringify({ ...session, keyPair: {}, theirPublicKeyB64: "" }));
		await (kvstore as MockKVStore)["store"].set("sessions:master-list", JSON.stringify(["3"]));

		const retrieved = await sessionstore.get("3");
		t.expect(retrieved).toBeNull();

		// Check that the session and master list entry were deleted
		const raw = await kvstore.get(key);
		t.expect(raw).toBeNull();
		const masterList = await kvstore.get("sessions:master-list");
		t.expect(masterList).toBe(JSON.stringify([]));
	});

	t.test("should list all non-expired sessions", async () => {
		const session1 = createSession("s1", Date.now() + 10000);
		const session2 = createSession("s2", Date.now() + 10000);
		await sessionstore.set(session1);
		await sessionstore.set(session2);

		const list = await sessionstore.list();
		t.expect(list).toHaveLength(2);
		t.expect(list.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
	});

	t.test("should delete a session", async () => {
		const session = createSession("s3", Date.now() + 10000);
		await sessionstore.set(session);
		let retrieved = await sessionstore.get("s3");
		t.expect(retrieved).not.toBeNull();

		await sessionstore.delete("s3");
		retrieved = await sessionstore.get("s3");
		t.expect(retrieved).toBeNull();
	});

	t.test("should return null and delete a corrupted session on get", async () => {
		const key = "session:corrupted";
		await kvstore.set(key, "this is not json");
		await (kvstore as MockKVStore)["store"].set("sessions:master-list", JSON.stringify(["corrupted"]));

		const retrieved = await sessionstore.get("corrupted");
		t.expect(retrieved).toBeNull();

		const raw = await kvstore.get(key);
		t.expect(raw).toBeNull();
	});

	t.test("should garbage collect expired sessions", async () => {
		const valid = createSession("valid", Date.now() + 10000);
		const expired = createSession("expired", Date.now() - 10000);

		// Manually set sessions in the kvstore
		await sessionstore.set(valid);
		// Manually setting an expired session by bypassing the `set` method's check
		const expiredKey = `session:${expired.id}`;
		await kvstore.set(expiredKey, JSON.stringify(expired));
		await (kvstore as MockKVStore)["store"].set("sessions:master-list", JSON.stringify(["valid", "expired"]));

		// Manually trigger garbage collection
		await (sessionstore as any).garbageCollect();

		const list = await sessionstore.list();
		t.expect(list).toHaveLength(1);
		t.expect(list[0].id).toBe("valid");

		const rawExpired = await kvstore.get(expiredKey);
		t.expect(rawExpired).toBeNull();
	});
});
