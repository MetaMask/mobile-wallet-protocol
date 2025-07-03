/**
 * Defines a persistent, asynchronous key-value storage interface.
 */
export interface IKVStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}
