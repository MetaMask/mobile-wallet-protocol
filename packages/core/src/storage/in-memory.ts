import type { IKVStore } from "../domain/kv-store";

/**
 * An in-memory implementation of IKVStore, primarily for testing purposes.
 * It uses a simple Map for storage and is not persistent.
 */
export class InMemoryKVStore implements IKVStore {
	private readonly store = new Map<string, string>();
	private readonly prefix: string;

	constructor(prefix = "mwp-") {
		this.prefix = prefix;
	}

	async get(key: string): Promise<string | null> {
		return this.store.get(this.getKey(key)) ?? null;
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(this.getKey(key), value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(this.getKey(key));
	}

	private getKey(key: string): string {
		return `${this.prefix}${key}`;
	}
}
