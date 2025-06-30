/**
 * Defines a persistent, asynchronous key-value store interface.
 * This must be implemented by the consuming client (dApp or wallet)
 * to handle session persistence securely.
 */
export abstract class IKVStore {
	protected prefix(key: string): string {
		return `metamask:mobile-wallet-protocol:${key}`;
	}

	abstract get(key: string): Promise<string | null>;
	abstract set(key: string, value: string): Promise<void>;
	abstract remove(key: string): Promise<void>;
}
