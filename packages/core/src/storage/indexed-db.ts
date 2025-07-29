import type { IKVStore } from "../domain/kv-store";

const DB_NAME = "mwp-kv-store";
const STORE_NAME = "key-value-pairs";

/**
 * A browser-compatible, IndexedDB-based implementation of IKVStore.
 * This is the recommended storage for web platforms due to its asynchronous
 * nature, larger storage capacity, and improved security over LocalStorage.
 */
export class IndexedDBKVStore implements IKVStore {
	private readonly prefix: string;
	private dbPromise: Promise<IDBDatabase>;

	constructor(prefix = "mwp-") {
		this.prefix = prefix;

		if (typeof window === "undefined" || !window.indexedDB) {
			throw new Error("IndexedDB is not available in this environment.");
		}

		this.dbPromise = new Promise((resolve, reject) => {
			const request = window.indexedDB.open(DB_NAME, 1);
			request.onerror = () => reject(new Error("Failed to open IndexedDB."));
			request.onsuccess = () => resolve(request.result);
			request.onupgradeneeded = () => {
				request.result.createObjectStore(STORE_NAME);
			};
		});
	}

	async get(key: string): Promise<string | null> {
		const db = await this.dbPromise;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const store = tx.objectStore(STORE_NAME);
			const request = store.get(this.getKey(key));
			request.onerror = () => reject(new Error("Failed to get value from IndexedDB."));
			request.onsuccess = () => resolve((request.result as string) ?? null);
		});
	}

	async set(key: string, value: string): Promise<void> {
		const db = await this.dbPromise;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const request = store.put(value, this.getKey(key));
			request.onerror = () => reject(new Error("Failed to set value in IndexedDB."));
			request.onsuccess = () => resolve();
		});
	}

	async delete(key: string): Promise<void> {
		const db = await this.dbPromise;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const request = store.delete(this.getKey(key));
			request.onerror = () => reject(new Error("Failed to delete value from IndexedDB."));
			request.onsuccess = () => resolve();
		});
	}

	private getKey(key: string): string {
		return `${this.prefix}${key}`;
	}
} 