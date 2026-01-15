import type { IKVStore } from "@metamask/mobile-wallet-protocol-core";

/**
 * Simple in-memory key-value store for session management.
 * Each client gets its own isolated store.
 */
export class InMemoryKVStore implements IKVStore {
	private store = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}
}

