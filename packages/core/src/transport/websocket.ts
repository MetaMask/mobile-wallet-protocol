import { EventEmitter } from "node:events";
import { Centrifuge, type Subscription } from "centrifuge";
import type { ITransport } from "../domain/transport";

export interface WebSocketTransportOptions {
	url: string;
	// biome-ignore lint/suspicious/noExplicitAny: options.websocket is a WebSocket constructor
	websocket?: any;
}

/**
 * An ITransport implementation using the `centrifuge-js` library.
 * It manages the WebSocket connection and channel subscriptions.
 */
export class WebSocketTransport extends EventEmitter implements ITransport {
	private readonly centrifuge: Centrifuge;
	private readonly subscriptions: Map<string, Subscription> = new Map();
	private isConnected = false;

	constructor(options: WebSocketTransportOptions) {
		super();
		this.centrifuge = new Centrifuge(options.url, { websocket: options.websocket });

		this.centrifuge.on("connected", () => {
			this.isConnected = true;
			this.emit("connected");
		});

		this.centrifuge.on("disconnected", () => {
			this.isConnected = false;
			this.emit("disconnected");
		});

		this.centrifuge.on("error", (ctx) => this.emit("error", new Error(ctx.error.message)));
	}

	public async connect(): Promise<void> {
		if (this.isConnected) {
			return;
		}
		return new Promise((resolve) => {
			this.centrifuge.once("connected", () => resolve());
			this.centrifuge.connect();
		});
	}

	public async disconnect(): Promise<void> {
		if (!this.isConnected) {
			return;
		}
		this.centrifuge.disconnect();
	}

	public async subscribe(channel: string): Promise<void> {
		if (this.subscriptions.has(channel)) {
			return;
		}

		const sub = this.centrifuge.newSubscription(channel);

		sub.on("publication", (ctx) => {
			const data = ctx.data as string;
			this.emit("message", { channel, data });
		});

		sub.on("error", (ctx) => {
			this.emit("error", new Error(`Subscription error on channel ${channel}: ${ctx.error.message}`));
		});

		await sub.subscribe();

		this.subscriptions.set(channel, sub);
	}

	public async publish(channel: string, message: string): Promise<void> {
		await this.centrifuge.publish(channel, message);
	}
}
