import { Mutex } from "async-mutex";
import { v4 as uuid } from "uuid";
import type { IKVStore } from "../../domain/kv-store";

/**
 * Manages persistent storage for WebSocket transport, including client ID and nonce management.
 * Supports per-channel nonce tracking and message deduplication across restarts.
 */
export class WebSocketTransportStorage {
	private readonly kvstore: IKVStore;
	private readonly clientId: string;
	private readonly nonceMutex = new Mutex();

	/**
	 * Creates a new WebSocketTransportStorage instance with a persistent client ID.
	 * If no client ID exists in storage, generates and persists a new one.
	 */
	static async create(kvstore: IKVStore): Promise<WebSocketTransportStorage> {
		const clientIdKey = WebSocketTransportStorage.getClientIdKey();
		let clientId = await kvstore.get(clientIdKey);
		if (!clientId) {
			clientId = uuid();
			await kvstore.set(clientIdKey, clientId);
		}
		return new WebSocketTransportStorage(kvstore, clientId);
	}

	private constructor(kvstore: IKVStore, clientId: string) {
		this.kvstore = kvstore;
		this.clientId = clientId;
	}

	/**
	 * Returns the persistent client ID for this transport.
	 */
	getClientId(): string {
		return this.clientId;
	}

	/**
	 * Gets the next nonce for publishing a message on the specified channel.
	 * Increments and persists the nonce counter for this client and channel.
	 */
	async getNextNonce(channel: string): Promise<number> {
		const key = this.getNonceKey(channel);
		const value = await this.kvstore.get(key);
		let currentNonce = value ? parseInt(value, 10) : 0;
		if (Number.isNaN(currentNonce)) currentNonce = 0;
		const nextNonce = currentNonce + 1;
		await this.kvstore.set(key, nextNonce.toString());
		return nextNonce;
	}

	/**
	 * Confirms a received nonce after the message has been successfully processed
	 * (e.g., decrypted). Only updates if the nonce is higher than the current value.
	 */
	async confirmNonce(channel: string, clientId: string, nonce: number): Promise<void> {
		await this.nonceMutex.runExclusive(async () => {
			const latestNonces = await this.getLatestNonces(channel);
			const current = latestNonces.get(clientId) || 0;
			if (nonce > current) {
				latestNonces.set(clientId, nonce);
				await this.setLatestNonces(channel, latestNonces);
			}
		});
	}

	/**
	 * Retrieves the latest received nonces from all senders on the specified channel.
	 * Used for message deduplication - only messages with nonces greater than the
	 * latest seen nonce from each sender are processed.
	 */
	async getLatestNonces(channel: string): Promise<Map<string, number>> {
		const key = this.getLatestNoncesKey(channel);
		const value = await this.kvstore.get(key);
		if (value) {
			const parsed = JSON.parse(value) as Record<string, number>;
			return new Map(Object.entries(parsed));
		}
		return new Map();
	}

	/**
	 * Updates the latest received nonces from all senders on the specified channel.
	 * This is used to track the highest nonce seen from each sender for deduplication.
	 */
	async setLatestNonces(channel: string, nonces: Map<string, number>): Promise<void> {
		const key = this.getLatestNoncesKey(channel);
		const obj = Object.fromEntries(nonces);
		await this.kvstore.set(key, JSON.stringify(obj));
	}

	/**
	 * Clears the storage for a given channel.
	 */
	async clear(channel: string): Promise<void> {
		const nonceKey = this.getNonceKey(channel);
		const latestNoncesKey = this.getLatestNoncesKey(channel);
		await Promise.all([this.kvstore.delete(nonceKey), this.kvstore.delete(latestNoncesKey)]);
	}

	/**
	 * Returns the key used to store the client ID.
	 */
	static getClientIdKey(): string {
		return "websocket-transport-client-id";
	}

	/**
	 * Returns the key used to store the nonce counter for a specific channel.
	 */
	getNonceKey(channel: string): string {
		return `nonce:${this.clientId}:${channel}`;
	}

	/**
	 * Returns the key used to store the latest nonces for a specific channel.
	 */
	getLatestNoncesKey(channel: string): string {
		return `latest-nonces:${this.clientId}:${channel}`;
	}
}
