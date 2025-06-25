import { EventEmitter } from "node:events";
import { Centrifuge, type ErrorContext, type Subscription } from "centrifuge";
import type { ITransport } from "../domain/transport";

export interface WebSocketTransportOptions {
	url: string;
	// biome-ignore lint/suspicious/noExplicitAny: options.websocket is a WebSocket constructor
	websocket?: any;
}

type TransportState = "disconnected" | "connecting" | "connected" | "error";

/**
 * An ITransport implementation using the `centrifuge-js` library.
 * It manages the WebSocket connection, channel subscriptions, and provides
 * robust connection and state management.
 */
export class WebSocketTransport extends EventEmitter implements ITransport {
	private readonly centrifuge: Centrifuge;
	private readonly subscriptions: Map<string, Subscription> = new Map();
	private state: TransportState = "disconnected";

	constructor(options: WebSocketTransportOptions) {
		super();

		this.centrifuge = new Centrifuge(options.url, { websocket: options.websocket });

		this.centrifuge.on("connecting", () => { this.setState("connecting"); });
		this.centrifuge.on("connected", () => { this.setState("connected"); });
		this.centrifuge.on("disconnected", () => { this.setState("disconnected"); });
		this.centrifuge.on("error", (ctx: ErrorContext) => {
			this.setState("error");
			this.emit("error", new Error(ctx.error.message));
		});
	}

	private setState(newState: TransportState) {
		if (this.state === newState) return;
		this.state = newState;
		this.emit(newState);
	}

	public async connect(): Promise<void> {
		if (this.state === "connected" || this.state === "connecting") {
			return;
		}

		this.setState("connecting");

		return new Promise((resolve, reject) => {
			this.centrifuge.once("connected", () => resolve());
			this.centrifuge.once("error", (ctx) => reject(new Error(ctx.error.message)));
			this.centrifuge.connect();
		});
	}

	public async disconnect(): Promise<void> {
		if (this.state === "disconnected") {
			return;
		}
		this.centrifuge.disconnect();
		this.subscriptions.clear();
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