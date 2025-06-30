import { EventEmitter } from "node:events";
import { Centrifuge, type PublicationContext, type SubscribedContext, type Subscription } from "centrifuge";
import { v4 as uuidv4 } from "uuid";
import type { IKVStore } from "../domain/kv-store";
import type { ITransport } from "../domain/transport";

/**
 * A transport-level envelope for all messages.
 *
 * This adds a unique, session-based nonce for deduplication and ordering
 * guarantees.
 */
interface TransportMessage {
	clientId: string;
	nonce: number;
	payload: string;
}

/**
 * Represents a message in the outgoing queue, including its promise handlers.
 */
interface QueuedMessage {
	channel: string;
	message: TransportMessage;
	resolve: () => void;
	reject: (reason?: Error) => void;
}

type TransportState = "disconnected" | "connecting" | "connected";

export interface WebSocketTransportOptions {
	url: string;
	websocket?: unknown;
}

/** The sliding window size for processed nonces, used for message deduplication. */
const MAX_PROCESSED_NONCES = 200;
/** The maximum number of messages to fetch from history upon a new subscription. */
const HISTORY_FETCH_LIMIT = 50;
/** The maximum number of retry attempts for publishing a message. */
const MAX_RETRY_ATTEMPTS = 5;
/** The base delay in milliseconds for exponential backoff between publish retries. */
const BASE_RETRY_DELAY = 100;

/**
 * Storage layer for WebSocket transport, handling client identification and nonce management.
 * Provides persistent storage for client ID and nonce tracking for message deduplication.
 */
export class WebSocketTransportStorage {
	private readonly kvstore: IKVStore;
	private readonly clientId: string;

	constructor(kvstore: IKVStore, clientId: string) {
		this.kvstore = kvstore;
		this.clientId = clientId;
	}

	/**
	 * Creates a new WebSocketTransportStorage instance, generating or retrieving a persistent client ID.
	 */
	static async create(kvstore: IKVStore): Promise<WebSocketTransportStorage> {
		const CLIENT_ID_KEY = "websocket-transport-client-id";
		let clientId = await kvstore.get(CLIENT_ID_KEY);

		if (!clientId) {
			clientId = uuidv4();
			await kvstore.set(CLIENT_ID_KEY, clientId);
		}

		return new WebSocketTransportStorage(kvstore, clientId);
	}

	/** Gets the client ID for this transport instance. */
	getClientId(): string {
		return this.clientId;
	}

	/** Increments and returns the next nonce value. */
	async incrementAndGetNonce(): Promise<number> {
		const key = `nonce_${this.clientId}`;
		const currentValue = await this.kvstore.get(key);
		const currentNonce = currentValue ? parseInt(currentValue, 10) : 0;
		const nextNonce = currentNonce + 1;
		await this.kvstore.set(key, nextNonce.toString());
		return nextNonce;
	}

	/** Retrieves the latest processed nonces for a channel. */
	async getLatestNonces(channel: string): Promise<Map<string, number>> {
		const key = `latestNonces_${this.clientId}_${channel}`;
		const value = await this.kvstore.get(key);
		if (value) {
			const obj = JSON.parse(value) as Record<string, number>;
			return new Map(Object.entries(obj));
		}
		return new Map();
	}

	/** Sets the latest processed nonces for a channel. */
	async setLatestNonces(channel: string, latestNonces: Map<string, number>): Promise<void> {
		const key = `latestNonces_${this.clientId}_${channel}`;
		const obj = Object.fromEntries(latestNonces);
		await this.kvstore.set(key, JSON.stringify(obj));
	}
}

/**
 * An ITransport implementation using `centrifuge-js`.
 * It provides a resilient WebSocket connection with message queuing, delivery
 * guarantees, and deduplication.
 */
export class WebSocketTransport extends EventEmitter implements ITransport {
	private readonly centrifuge: Centrifuge;
	private readonly clientId: string;
	private readonly storage: WebSocketTransportStorage;
	private readonly subscriptions: Map<string, Subscription> = new Map();
	private state: TransportState = "disconnected";

	private isProcessingQueue = false;
	private readonly queue: QueuedMessage[] = [];

	/**
	 * Private constructor. Use WebSocketTransport.create() instead.
	 */
	private constructor(options: WebSocketTransportOptions, storage: WebSocketTransportStorage) {
		super();

		this.storage = storage;
		this.clientId = storage.getClientId();

		this.centrifuge = new Centrifuge(options.url, {
			websocket: options.websocket,
			minReconnectDelay: 100,
			maxReconnectDelay: 30000,
		});

		this.centrifuge.on("connecting", () => this.setState("connecting"));
		this.centrifuge.on("connected", () => {
			this.setState("connected");
			this._processQueue();
		});
		this.centrifuge.on("disconnected", () => this.setState("disconnected"));
		this.centrifuge.on("error", (ctx) => this.emit("error", new Error(ctx.error.message)));
	}

	/**
	 * Creates a new WebSocketTransport instance with async initialization.
	 * Generates or retrieves a persistent client ID automatically.
	 */
	static async create(kvstore: IKVStore, options: WebSocketTransportOptions): Promise<WebSocketTransport> {
		const storage = await WebSocketTransportStorage.create(kvstore);
		return new WebSocketTransport(options, storage);
	}

	/**
	 * Connects to the transport.
	 *
	 * @returns A promise that resolves when the transport is connected.
	 */
	public connect(): Promise<void> {
		if (this.state === "connected" || this.state === "connecting") {
			return Promise.resolve();
		}
		this.setState("connecting");
		return new Promise((resolve) => {
			this.centrifuge.once("connected", () => resolve());
			this.centrifuge.connect();
		});
	}

	/**
	 * Disconnects from the transport.
	 *
	 * @returns A promise that resolves when the transport is disconnected.
	 */
	public disconnect(): Promise<void> {
		this.queue.forEach((msg) => msg.reject(new Error("Transport disconnected by client.")));
		this.queue.length = 0;

		if (this.state === "disconnected") {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			this.subscriptions.clear();
			this.centrifuge.once("disconnected", () => resolve());
			this.centrifuge.disconnect();
		});
	}

	/**
	 * Subscribes to a channel.
	 *
	 * @param channel - The channel to subscribe to.
	 * @returns A promise that resolves when the subscription is established.
	 */
	public subscribe(channel: string): Promise<void> {
		if (this.subscriptions.has(channel)) {
			return Promise.resolve();
		}

		const sub = this.centrifuge.newSubscription(channel, { recoverable: true, positioned: true });

		sub.on("subscribed", (ctx: SubscribedContext) => {
			if (!ctx.recovered) {
				this._fetchHistory(sub, channel);
			}
			this._processQueue();
		});

		sub.on("publication", (ctx: PublicationContext) => {
			this._handleIncomingMessage(channel, ctx.data as string);
		});

		sub.on("error", (ctx) => this.emit("error", new Error(`Subscription error: ${ctx.error.message}`)));

		this.subscriptions.set(channel, sub);

		return new Promise((resolve) => {
			sub.once("subscribed", () => resolve());
			sub.subscribe();
		});
	}

	/**
	 * Publishes a message to the given channel.
	 *
	 * @param channel - The channel to publish the message to.
	 * @param payload - The message payload to publish.
	 * @returns A promise that resolves when the message is published.
	 */
	public async publish(channel: string, payload: string): Promise<void> {
		const nonce = await this.storage.incrementAndGetNonce();
		const message: TransportMessage = { clientId: this.clientId, nonce, payload };
		const promise = new Promise<void>((resolve, reject) => {
			this.queue.push({ channel, message, resolve, reject });
		});
		this._processQueue();
		return promise;
	}

	private setState(newState: TransportState) {
		if (this.state === newState) return;
		this.state = newState;
		this.emit(newState);
	}

	/**
	 * Parses an incoming raw message, checks for duplicates, and emits it.
	 */
	private async _handleIncomingMessage(channel: string, rawData: string): Promise<void> {
		try {
			const message = JSON.parse(rawData) as TransportMessage;
			if (typeof message.clientId !== "string" || typeof message.nonce !== "number" || typeof message.payload !== "string") {
				throw new Error("Invalid message format");
			}

			// Ignore our own messages reflected from the server.
			if (message.clientId === this.clientId) {
				return;
			}

			const latestNonces = await this.storage.getLatestNonces(channel);
			const latestNonce = latestNonces.get(message.clientId) || 0;
			if (message.nonce > latestNonce) {
				latestNonces.set(message.clientId, message.nonce);
				await this.storage.setLatestNonces(channel, latestNonces);
				this.emit("message", { channel, data: message.payload });
			}
		} catch (error) {
			this.emit("error", new Error(`Failed to parse incoming message: ${JSON.stringify(error)}`));
		}
	}

	/**
	 * Fetches historical messages for a channel to ensure no data is missed on first subscribe.
	 */
	private async _fetchHistory(sub: Subscription, channel: string): Promise<void> {
		try {
			const history = await sub.history({ limit: HISTORY_FETCH_LIMIT });
			for (const pub of history.publications) {
				await this._handleIncomingMessage(channel, pub.data as string);
			}
		} catch (error) {
			// Centrifuge may throw an error (code 11) if the connection closes
			// during a history fetch. This is expected on disconnect and can be ignored.
			if ((error as { code?: number })?.code === 11) {
				return;
			}
			this.emit("error", new Error(`Failed to fetch history for channel ${channel}: ${JSON.stringify(error)}`));
		}
	}

	/**
	 * Attempts to publish a single message from the queue with retry logic.
	 */
	private async _publish(item: QueuedMessage): Promise<void> {
		const data = JSON.stringify(item.message);

		for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
			try {
				await this.centrifuge.publish(item.channel, data);
				return; // Success, exit the loop.
			} catch (error) {
				// If this was the last attempt, re-throw the error.
				if (attempt === MAX_RETRY_ATTEMPTS - 1) {
					throw error;
				}

				const expbackoff = BASE_RETRY_DELAY * 2 ** attempt;
				await new Promise((resolve) => setTimeout(resolve, expbackoff));
			}
		}
	}

	/**
	 * Processes the outgoing message queue serially.
	 */
	private async _processQueue(): Promise<void> {
		if (this.isProcessingQueue || this.state !== "connected") {
			return;
		}

		this.isProcessingQueue = true;

		try {
			while (this.queue.length > 0) {
				const item = this.queue[0]; // Peek at the first item.
				try {
					await this._publish(item);
					this.queue.shift(); // Remove from queue on success.
					item.resolve();
				} catch (error) {
					// Remove the failed item from queue and reject its promise.
					this.queue.shift();
					item.reject(error instanceof Error ? error : new Error("Failed to publish message after all retries"));
				}
			}
		} finally {
			this.isProcessingQueue = false;
		}
	}
}
