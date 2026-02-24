import { Mutex } from "async-mutex";
import { ErrorCode, SessionError } from "../domain/errors";
import type { IKVStore } from "../domain/kv-store";
import type { Session } from "../domain/session";
import type { ISessionStore } from "../domain/session-store";
import { validateSecp256k1PublicKey } from "../utils/validate-public-key";

/**
 * Serializable representation of a Session where Uint8Array keys are converted to base64 strings.
 */
type SerializableSession = {
	id: string;
	channel: string;
	keyPair: {
		publicKeyB64: string;
		privateKeyB64: string;
	};
	theirPublicKeyB64: string;
	expiresAt: number;
};

/**
 * The time-to-live for a session.
 */
export const DEFAULT_SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Manages persistent storage of Session objects.
 * Handles serialization/deserialization and maintains a master list of session IDs.
 */
export class SessionStore implements ISessionStore {
	private static readonly SESSION_PREFIX = "session:";
	private static readonly MASTER_LIST_KEY = "sessions:master-list";

	private readonly kvstore: IKVStore;
	private readonly mutex = new Mutex();

	/**
	 * Creates a new SessionStore instance with a clean state.
	 * Runs garbage collection to remove any expired sessions before returning.
	 */
	static async create(kvstore: IKVStore): Promise<SessionStore> {
		const store = new SessionStore(kvstore);
		await store.garbageCollect();
		return store;
	}

	private constructor(kvstore: IKVStore) {
		this.kvstore = kvstore;
	}

	/**
	 * Sets a session in the store.
	 * @param session - The session to set.
	 */
	async set(session: Session): Promise<void> {
		// Check if session is expired
		if (Number.isNaN(session.expiresAt) || session.expiresAt < Date.now()) {
			throw new SessionError(ErrorCode.SESSION_SAVE_FAILED, "Cannot save expired session");
		}

		// Serialize the session
		const data: SerializableSession = {
			id: session.id,
			channel: session.channel,
			keyPair: {
				publicKeyB64: Buffer.from(session.keyPair.publicKey).toString("base64"),
				privateKeyB64: Buffer.from(session.keyPair.privateKey).toString("base64"),
			},
			theirPublicKeyB64: Buffer.from(session.theirPublicKey).toString("base64"),
			expiresAt: session.expiresAt,
		};

		// Store the session
		const key = this.getSessionKey(session.id);
		await this.kvstore.set(key, JSON.stringify(data));

		// Update master list
		await this.addToMasterList(session.id);
	}

	/**
	 * Gets a session from the store.
	 * @param id - The ID of the session to get.
	 * @returns The session if it exists, otherwise null.
	 */
	async get(id: string): Promise<Session | null> {
		const key = this.getSessionKey(id);
		const raw = await this.kvstore.get(key);
		if (!raw) return null;

		try {
			const data: SerializableSession = JSON.parse(raw);

			// Check if session is expired (handles NaN, non-number, and past timestamps)
			if (typeof data.expiresAt !== "number" || !(data.expiresAt >= Date.now())) {
				// Session expired, clean it up
				await this.delete(id);
				return null;
			}

			// Deserialize back to Session
			const theirPublicKey = new Uint8Array(Buffer.from(data.theirPublicKeyB64, "base64"));
			validateSecp256k1PublicKey(theirPublicKey);

			const session: Session = {
				id: data.id,
				channel: data.channel,
				keyPair: {
					publicKey: new Uint8Array(Buffer.from(data.keyPair.publicKeyB64, "base64")),
					privateKey: new Uint8Array(Buffer.from(data.keyPair.privateKeyB64, "base64")),
				},
				theirPublicKey,
				expiresAt: data.expiresAt,
			};

			return session;
		} catch {
			// If deserialization fails, clean up the corrupted session
			await this.delete(id);
			return null;
		}
	}

	/**
	 * Lists all sessions in the store.
	 * @returns A list of all sessions.
	 */
	async list(): Promise<Session[]> {
		const ids = await this.getMasterList();
		const sessions: Session[] = [];

		for (const id of ids) {
			const session = await this.get(id);
			if (session) sessions.push(session);
		}

		return sessions;
	}

	/**
	 * Deletes a session from the store.
	 * @param id - The ID of the session to delete.
	 */
	async delete(id: string): Promise<void> {
		const key = this.getSessionKey(id);
		await this.kvstore.delete(key);
		await this.removeFromMasterList(id);
	}

	/**
	 * Garbage collects expired sessions.
	 */
	private async garbageCollect(): Promise<void> {
		const list = await this.getMasterList();
		// Calling `get` for each session will delete it if it's expired.
		await Promise.all(list.map(async (id) => this.get(id)));
	}

	/**
	 * Gets the key for a session.
	 * @param id - The ID of the session.
	 * @returns The key for the session.
	 */
	private getSessionKey(id: string): string {
		return `${SessionStore.SESSION_PREFIX}${id}`;
	}

	/**
	 * Gets the master list of session IDs.
	 * @returns The master list of session IDs.
	 */
	private async getMasterList(): Promise<string[]> {
		const raw = await this.kvstore.get(SessionStore.MASTER_LIST_KEY);
		if (!raw) return [];

		try {
			return JSON.parse(raw) as string[];
		} catch {
			return [];
		}
	}

	/**
	 * Adds a session ID to the master list.
	 * Protected by a mutex to prevent concurrent read/modify/write corruption.
	 * @param id - The ID of the session to add.
	 */
	private async addToMasterList(id: string): Promise<void> {
		await this.mutex.runExclusive(async () => {
			const list = await this.getMasterList();
			if (!list.includes(id)) {
				list.push(id);
				await this.kvstore.set(SessionStore.MASTER_LIST_KEY, JSON.stringify(list));
			}
		});
	}

	/**
	 * Removes a session ID from the master list.
	 * Protected by a mutex to prevent concurrent read/modify/write corruption.
	 * @param id - The ID of the session to remove.
	 */
	private async removeFromMasterList(id: string): Promise<void> {
		await this.mutex.runExclusive(async () => {
			const list = await this.getMasterList();
			const filtered = list.filter((sessionId) => sessionId !== id);
			await this.kvstore.set(SessionStore.MASTER_LIST_KEY, JSON.stringify(filtered));
		});
	}
}
