import { Centrifuge, type Options, type PublicationContext, type SubscribedContext, type Subscription } from "centrifuge";
import EventEmitter from "eventemitter3";
import { ErrorCode, TransportError } from "../../domain/errors";
import type { IKVStore } from "../../domain/kv-store";
import type { ITransport } from "../../domain/transport";
import { retry } from "../../utils/retry";
import { WebSocketTransportStorage } from "./store";

/**
 * A transport-level envelope for all messages.
 *
 * This adds a unique, session-based nonce for deduplication and ordering
 * guarantees.
 */
type TransportMessage = {
	clientId: string;
	nonce: number;
	payload: string;
};

/**
 * Represents a message in the outgoing queue, including its promise handlers.
 */
type QueuedItem = {
	channel: string;
	payload: string;
	resolve: (ok: boolean) => void;
	reject: (reason?: Error) => void;
};

/**
 * Options for creating a WebSocketTransport instance.
 */
export type WebSocketTransportOptions = {
	/** URL of the relay server. */
	url: string;
	/** Key-value store to use for storage. */
	kvstore: IKVStore;
	/** Optional WebSocket client to use. Mainly for testing or non-browser environments. */
	websocket?: unknown;
};

type TransportState = "disconnected" | "connecting" | "connected";

/** The maximum number of messages to fetch from history upon a new subscription. */
const HISTORY_FETCH_LIMIT = 50;
/** The maximum number of retry attempts for publishing a message. */
const MAX_RETRY_ATTEMPTS = 5;
/** The base delay in milliseconds for exponential backoff between publish retries. */
const BASE_RETRY_DELAY = 100;

/**
 * An ITransport implementation using `centrifuge-js`.
 * It provides a resilient WebSocket connection with message queuing, delivery
 * guarantees, and deduplication.
 */
export class WebSocketTransport extends EventEmitter implements ITransport {
	private readonly centrifuge: Centrifuge;
	private readonly storage: WebSocketTransportStorage;
	private readonly queue: QueuedItem[] = [];
	private isProcessingQueue = false;
	private state: TransportState = "disconnected";

	/**
	 * Creates a new WebSocketTransport instance. The storage parameter must be provided
	 * to enable persistence across restarts.
	 */
	static async create(options: WebSocketTransportOptions): Promise<WebSocketTransport> {
		const storage = await WebSocketTransportStorage.create(options.kvstore);
		return new WebSocketTransport(storage, options);
	}

	private constructor(storage: WebSocketTransportStorage, options: WebSocketTransportOptions) {
		super();

		this.storage = storage;

		const opts: Partial<Options> = {
			minReconnectDelay: 100,
			maxReconnectDelay: 30000,
		};

		if (options.websocket !== undefined) {
			opts.websocket = options.websocket;
		}

		this.centrifuge = new Centrifuge(options.url, opts);

		this.centrifuge.on("connecting", () => this.setState("connecting"));
		this.centrifuge.on("connected", () => {
			this.setState("connected");
			this._processQueue();
		});
		this.centrifuge.on("disconnected", () => this.setState("disconnected"));
		this.centrifuge.on("error", (ctx) => this.emit("error", new TransportError(ErrorCode.UNKNOWN, ctx.error.message)));
	}

	/**
	 * Connects to the relay server.
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
	 * Disconnects from the relay server.
	 */
	public disconnect(): Promise<void> {
		this.queue.forEach((msg) => msg.resolve(false));
		this.queue.length = 0;

		if (this.state === "disconnected") {
			return Promise.resolve();
		}

		return new Promise((resolve) => {
			const subs = this.centrifuge.subscriptions();
			for (const sub of Object.values(subs)) {
				this.centrifuge.removeSubscription(sub);
			}
			this.centrifuge.once("disconnected", () => resolve());
			this.centrifuge.disconnect();
		});
	}

	/**
	 * Subscribes to a channel and fetches historical messages and sends any queued messages.
	 */
	public subscribe(channel: string): Promise<void> {
		if (this.centrifuge.getSubscription(channel)) {
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

		sub.on("error", (ctx) => this.emit("error", new TransportError(ErrorCode.TRANSPORT_SUBSCRIBE_FAILED, `Subscription error: ${ctx.error.message}`)));

		return new Promise((resolve) => {
			sub.once("subscribed", () => resolve());
			sub.subscribe();
		});
	}

	/**
	 * Publishes a message to a channel. Returns a promise that resolves when the message is published.
	 */
	public publish(channel: string, payload: string): Promise<boolean> {
		const promise = new Promise<boolean>((resolve, reject) => {
			this.queue.push({ channel, payload, resolve, reject });
		});
		this._processQueue();
		return promise;
	}

	/**
	 * Clears the transport for a given channel.
	 */
	public async clear(channel: string): Promise<void> {
		await this.storage.clear(channel);
		const sub = this.centrifuge.getSubscription(channel);
		if (sub) this.centrifuge.removeSubscription(sub);
	}

	/**
	 * Sets the internal state of the transport.
	 */
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
				throw new TransportError(ErrorCode.TRANSPORT_PARSE_FAILED, "Invalid message format");
			}

			// Ignore our own messages reflected from the server.
			if (message.clientId === this.storage.getClientId()) {
				return;
			}

			// Per-channel deduplication using persistent storage.
			const latestNonces = await this.storage.getLatestNonces(channel);
			const latestNonce = latestNonces.get(message.clientId) || 0;

			if (message.nonce > latestNonce) {
				// This is a new message, update the latest nonce and emit the message.
				latestNonces.set(message.clientId, message.nonce);
				await this.storage.setLatestNonces(channel, latestNonces);
				this.emit("message", { channel, data: message.payload });
			}
			// If message.nonce <= latestNonce, it's a duplicate and we ignore it.
		} catch (error) {
			this.emit("error", new TransportError(ErrorCode.TRANSPORT_PARSE_FAILED, `Failed to parse incoming message: ${error instanceof Error ? error.message : "Unknown error"}`));
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
			if ((error as { code?: number })?.code === 11) return;
			this.emit("error", new TransportError(ErrorCode.TRANSPORT_HISTORY_FAILED, `Failed to fetch history for channel ${channel}: ${JSON.stringify(error)}`));
		}
	}

	/**
	 * Attempts to publish a single message from the queue with retry logic.
	 */
	private async _process(item: QueuedItem): Promise<void> {
		const clientId = this.storage.getClientId();
		const nonce = await this.storage.getNextNonce(item.channel);
		const message: TransportMessage = { clientId, nonce, payload: item.payload };
		const data = JSON.stringify(message);

		const publishFn = async () => {
			await this.centrifuge.publish(item.channel, data);
		};

		return retry(publishFn, { attempts: MAX_RETRY_ATTEMPTS, delay: BASE_RETRY_DELAY });
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
					await this._process(item);
					this.queue.shift(); // Remove from queue on success.
					item.resolve(true);
				} catch (error) {
					// Remove the failed item from queue and reject its promise.
					this.queue.shift();
					item.reject(error instanceof Error ? error : new TransportError(ErrorCode.TRANSPORT_PUBLISH_FAILED, "Failed to publish message after all retries"));
				}
			}
		} finally {
			this.isProcessingQueue = false;
		}
	}
}
