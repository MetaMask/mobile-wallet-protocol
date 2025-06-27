import { EventEmitter } from "node:events";
import { Centrifuge, type PublicationContext, type SubscribedContext, type Subscription } from "centrifuge";
import { v4 as uuid } from "uuid";
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

export interface WebSocketTransportOptions {
	url: string;
	websocket?: unknown;
}

type TransportState = "disconnected" | "connecting" | "connected";

/** The sliding window size for processed nonces, used for message deduplication. */
const MAX_PROCESSED_NONCES = 200;
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
	private readonly subscriptions: Map<string, Subscription> = new Map();
	private state: TransportState = "disconnected";
	private readonly clientId = uuid(); // FIXME

	private nonce = 0;
	private readonly processedNonces: Set<number> = new Set();

	private isProcessingQueue = false;
	private readonly queue: QueuedMessage[] = [];

	constructor(options: WebSocketTransportOptions) {
		super();

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

	private setState(newState: TransportState) {
		if (this.state === newState) return;
		this.state = newState;
		this.emit(newState);
	}

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

	public publish(channel: string, payload: string): Promise<void> {
		const promise = this._enqueue(channel, payload);
		this._processQueue();
		return promise;
	}

	/**
	 * Creates a message envelope, adds it to the outgoing queue, and returns a promise.
	 */
	private _enqueue(channel: string, payload: string): Promise<void> {
		this.nonce += 1;

		const message: TransportMessage = { clientId: this.clientId, nonce: this.nonce, payload };

		return new Promise((resolve, reject) => {
			this.queue.push({ channel, message, resolve, reject });
		});
	}

	/**
	 * Parses an incoming raw message, checks for duplicates, and emits it.
	 */
	private _handleIncomingMessage(channel: string, rawData: string): void {
		try {
			const message = JSON.parse(rawData) as TransportMessage;
			if (typeof message.clientId !== "string" || typeof message.nonce !== "number" || typeof message.payload !== "string") {
				throw new Error("Invalid message format");
			}

			// Ignore our own messages reflected from the server.
			if (message.clientId === this.clientId) {
				return;
			}

			// Deduplication using our own transport-level nonce.
			if (this.processedNonces.has(message.nonce)) {
				return;
			}
			this.processedNonces.add(message.nonce);

			// Keep the sliding window of nonces from growing indefinitely.
			if (this.processedNonces.size > MAX_PROCESSED_NONCES) {
				const oldestNonce = Math.min(...this.processedNonces);
				this.processedNonces.delete(oldestNonce);
			}

			this.emit("message", { channel, data: message.payload });
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
				this._handleIncomingMessage(channel, pub.data as string);
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
