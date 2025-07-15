import type { IKVStore } from '@metamask/mobile-wallet-protocol-core';

/**
 * Browser-compatible localStorage-based implementation of IKVStore
 */
export class LocalStorageKVStore implements IKVStore {
	private readonly prefix: string;

	constructor(prefix: string = 'mwp-') {
		this.prefix = prefix;
	}

	async get(key: string): Promise<string | null> {
		try {
			return localStorage.getItem(this.getKey(key));
		} catch (error) {
			console.warn('Failed to get from localStorage:', error);
			return null;
		}
	}

	async set(key: string, value: string): Promise<void> {
		try {
			localStorage.setItem(this.getKey(key), value);
		} catch (error) {
			console.warn('Failed to set in localStorage:', error);
			throw error;
		}
	}

	async delete(key: string): Promise<void> {
		try {
			localStorage.removeItem(this.getKey(key));
		} catch (error) {
			console.warn('Failed to delete from localStorage:', error);
			throw error;
		}
	}

	private getKey(key: string): string {
		return `${this.prefix}${key}`;
	}
} 