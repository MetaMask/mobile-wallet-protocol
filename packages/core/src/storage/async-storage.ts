// We use a type-only import here to get the shape of AsyncStorage without creating a runtime dependency.
import type { AsyncStorageStatic } from "@react-native-async-storage/async-storage";
import type { IKVStore } from "../domain/kv-store";

/**
 * React Native-compatible AsyncStorage-based implementation of IKVStore.
 * This class uses dependency injection to receive the AsyncStorage module,
 * avoiding bundling issues in monorepos.
 */
export class AsyncStorageKVStore implements IKVStore {
	private readonly prefix: string;
	private readonly storage: AsyncStorageStatic;

	/**
	 * Creates an instance of AsyncStorageKVStore.
	 * @param storage - The AsyncStorage module itself, imported from '@react-native-async-storage/async-storage'.
	 * @param prefix - An optional prefix for all storage keys.
	 */
	constructor(storage: AsyncStorageStatic, prefix = "mwp-") {
		if (!storage) {
			throw new Error("The AsyncStorage module must be provided to the AsyncStorageKVStore constructor.");
		}
		this.prefix = prefix;
		this.storage = storage;
	}

	async get(key: string): Promise<string | null> {
		try {
			return await this.storage.getItem(this.getKey(key));
		} catch (error) {
			console.warn("Failed to get from AsyncStorage:", error);
			return null;
		}
	}

	async set(key: string, value: string): Promise<void> {
		try {
			await this.storage.setItem(this.getKey(key), value);
		} catch (error) {
			console.warn("Failed to set in AsyncStorage:", error);
			throw error;
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await this.storage.removeItem(this.getKey(key));
		} catch (error) {
			console.warn("Failed to delete from AsyncStorage:", error);
			throw error;
		}
	}

	private getKey(key: string): string {
		return `${this.prefix}${key}`;
	}
}
