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

	t.beforeEach(async () => {
		kvstore = new MockKVStore();
		sessionstore = await SessionStore.create(kvstore);
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

	t.test("should reject a session with NaN expiresAt on set", async () => {
		const session = createSession("nan-set", Number.NaN);
		await t.expect(sessionstore.set(session)).rejects.toThrow("Cannot save expired session");
	});

	t.test("should treat a session with NaN expiresAt as expired on get", async () => {
		const key = "session:nan-get";
		const data = {
			id: "nan-get",
			channel: "test-channel",
			keyPair: { publicKeyB64: Buffer.from(new Uint8Array(33).fill(1)).toString("base64"), privateKeyB64: Buffer.from(new Uint8Array(32).fill(1)).toString("base64") },
			theirPublicKeyB64: Buffer.from(new Uint8Array(33).fill(2)).toString("base64"),
			expiresAt: "not-a-number",
		};
		await kvstore.set(key, JSON.stringify(data));
		await (kvstore as MockKVStore)["store"].set("sessions:master-list", JSON.stringify(["nan-get"]));

		const retrieved = await sessionstore.get("nan-get");
		t.expect(retrieved).toBeNull();
	});

	t.test("should complete GC before the first public method returns", async () => {
		const freshKvstore = new MockKVStore();
		const validSession = createSession("valid", Date.now() + 10000);
		const expiredSession = createSession("expired", Date.now() - 10000);

		// Seed store with one valid and one expired session
		await freshKvstore.set(
			"session:valid",
			JSON.stringify({
				...validSession,
				keyPair: { publicKeyB64: Buffer.from(validSession.keyPair.publicKey).toString("base64"), privateKeyB64: Buffer.from(validSession.keyPair.privateKey).toString("base64") },
				theirPublicKeyB64: Buffer.from(validSession.theirPublicKey).toString("base64"),
			}),
		);
		await freshKvstore.set(
			"session:expired",
			JSON.stringify({
				...expiredSession,
				keyPair: {
					publicKeyB64: Buffer.from(expiredSession.keyPair.publicKey).toString("base64"),
					privateKeyB64: Buffer.from(expiredSession.keyPair.privateKey).toString("base64"),
				},
				theirPublicKeyB64: Buffer.from(expiredSession.theirPublicKey).toString("base64"),
			}),
		);
		await freshKvstore.set("sessions:master-list", JSON.stringify(["valid", "expired"]));

		const store = await SessionStore.create(freshKvstore);
		const list = await store.list();
		t.expect(list).toHaveLength(1);
		t.expect(list[0].id).toBe("valid");
	});

	t.test("should not lose entries when multiple sessions are set concurrently", async () => {
		const promises = [];
		for (let i = 0; i < 10; i++) {
			promises.push(sessionstore.set(createSession(`concurrent-${i}`, Date.now() + 10000)));
		}
		await Promise.all(promises);

		const list = await sessionstore.list();
		t.expect(list).toHaveLength(10);
	});
});
