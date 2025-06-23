/**
 * Defines a persistent, asynchronous key-value storage interface.
 * This must be implemented by the consuming client (dApp or wallet)
 * to handle session persistence securely.
 */
export interface IStorage {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
}