import { v4 as uuid } from "uuid";
import type { IKVStore } from "../../domain/kv-store";

/**
 * Manages persistent storage for WebSocket transport, including client ID and nonce management.
 * Supports per-channel nonce tracking and message deduplication across restarts.
 */
export class WebSocketTransportStorage {
	private readonly kvstore: IKVStore;
	private readonly clientId: string;

	/**
	 * Creates a new WebSocketTransportStorage instance with a persistent client ID.
	 * If no client ID exists in storage, generates and persists a new one.
	 */
	static async create(kvstore: IKVStore): Promise<WebSocketTransportStorage> {
		const CLIENT_ID_KEY = "websocket-transport-client-id";
		let clientId = await kvstore.get(CLIENT_ID_KEY);
		if (!clientId) {
			clientId = uuid();
			await kvstore.set(CLIENT_ID_KEY, clientId);
		}
		return new WebSocketTransportStorage(kvstore, clientId);
	}

	private constructor(kvstore: IKVStore, clientId: string) {
		this.kvstore = kvstore;
		this.clientId = clientId;
	}

	/**
	 * Returns the persistent client ID for this transport instance.
	 */
	getClientId(): string {
		return this.clientId;
	}

	/**
	 * Gets the next nonce for publishing a message on the specified channel.
	 * Increments and persists the nonce counter for this client and channel.
	 */
	async getNextNonce(channel: string): Promise<number> {
		const key = `nonce:${this.clientId}:${channel}`;
		const value = await this.kvstore.get(key);
		const currentNonce = value ? parseInt(value, 10) : 0;
		const nextNonce = currentNonce + 1;
		await this.kvstore.set(key, nextNonce.toString());
		return nextNonce;
	}

	/**
	 * Retrieves the latest received nonces from all senders on the specified channel.
	 * Used for message deduplication - only messages with nonces greater than the
	 * latest seen nonce from each sender are processed.
	 */
	async getLatestNonces(channel: string): Promise<Map<string, number>> {
		const key = `latest-nonces:${this.clientId}:${channel}`;
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
		const key = `latest-nonces:${this.clientId}:${channel}`;
		const obj = Object.fromEntries(nonces);
		await this.kvstore.set(key, JSON.stringify(obj));
	}

	/**
	 * Cleans up channel-specific storage keys when a session ends.
	 * This prevents unbounded storage growth.
	 */
	async cleanupChannel(channel: string): Promise<void> {
		const nonceKey = `nonce:${this.clientId}:${channel}`;
		const latestNoncesKey = `latest-nonces:${this.clientId}:${channel}`;

		await Promise.all([this.kvstore.remove(nonceKey), this.kvstore.remove(latestNoncesKey)]);
	}
}
