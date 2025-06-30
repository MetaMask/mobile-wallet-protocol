import { IKVStore } from "../domain/kv-store";

export class InMemoryKVStore extends IKVStore {
	private store = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		return this.store.get(this.prefix(key)) ?? null;
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(this.prefix(key), value);
	}

	async remove(key: string): Promise<void> {
		this.store.delete(this.prefix(key));
	}
}
