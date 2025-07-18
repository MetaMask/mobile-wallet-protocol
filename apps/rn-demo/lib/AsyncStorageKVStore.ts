import type { IKVStore } from "@metamask/mobile-wallet-protocol-core";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * React Native-compatible AsyncStorage-based implementation of IKVStore
 */
export class AsyncStorageKVStore implements IKVStore {
	private readonly prefix: string;

	constructor(prefix = "mwp-") {
		this.prefix = prefix;
	}

	async get(key: string): Promise<string | null> {
		try {
			return await AsyncStorage.getItem(this.getKey(key));
		} catch (error) {
			console.warn("Failed to get from AsyncStorage:", error);
			return null;
		}
	}

	async set(key: string, value: string): Promise<void> {
		try {
			await AsyncStorage.setItem(this.getKey(key), value);
		} catch (error) {
			console.warn("Failed to set in AsyncStorage:", error);
			throw error;
		}
	}

	async delete(key: string): Promise<void> {
		try {
			await AsyncStorage.removeItem(this.getKey(key));
		} catch (error) {
			console.warn("Failed to delete from AsyncStorage:", error);
			throw error;
		}
	}

	private getKey(key: string): string {
		return `${this.prefix}${key}`;
	}
}
