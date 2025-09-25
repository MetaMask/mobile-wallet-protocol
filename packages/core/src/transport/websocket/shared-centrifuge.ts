import {
	Centrifuge,
	type ClientEvents,
	type HistoryOptions,
	type HistoryResult,
	type Options,
	type PublicationContext,
	type PublishResult,
	type SubscribedContext,
	type Subscription,
	type SubscriptionErrorContext,
	type SubscriptionOptions,
	type UnsubscribedContext,
} from "centrifuge";
import EventEmitter from "eventemitter3";

/**
 * Interface for Centrifuge subscriptions used by SharedCentrifuge.
 * Provides a consistent API that matches the centrifuge-js Subscription interface.
 */
export interface ISubscription extends EventEmitter {
	readonly channel: string;
	readonly state: string;
	subscribe(): void;
	unsubscribe(): void;
	// biome-ignore lint/suspicious/noExplicitAny: to match centrifuge-js interface
	publish(data: any): Promise<PublishResult>;
	history(options: HistoryOptions): Promise<HistoryResult>;
}

/**
 * Proxy wrapper around Centrifuge Subscription that forwards events.
 * Allows SharedCentrifuge to provide a consistent interface while hiding
 * the complexity of the underlying subscription management.
 */
class SubscriptionProxy extends EventEmitter implements ISubscription {
	constructor(
		public readonly realSub: Subscription,
		private readonly parent: SharedCentrifuge,
	) {
		super();
		// Forward all subscription events to listeners of this proxy
		this.realSub.on("publication", (ctx: PublicationContext) => this.emit("publication", ctx));
		this.realSub.on("subscribed", (ctx: SubscribedContext) => this.emit("subscribed", ctx));
		this.realSub.on("unsubscribed", (ctx: UnsubscribedContext) => this.emit("unsubscribed", ctx));
		this.realSub.on("error", (ctx: SubscriptionErrorContext) => this.emit("error", ctx));
	}
	get channel(): string {
		return this.realSub.channel;
	}
	get state(): string {
		return this.realSub.state;
	}
	subscribe(): void {
		this.realSub.subscribe();
	}
	unsubscribe(): void {
		this.realSub.unsubscribe();
		// Notify the parent to decrement the reference count
		this.parent.removeSubscription(this);
	}
	// biome-ignore lint/suspicious/noExplicitAny: to match centrifuge-js interface
	async publish(data: any): Promise<PublishResult> {
		return await this.realSub.publish(data);
	}
	history(options: HistoryOptions): Promise<HistoryResult> {
		return this.realSub.history(options);
	}
}

/**
 * Context contains all the shared state for a single Centrifuge connection.
 */
type Context = {
	centrifuge: Centrifuge;
	refcount: number;
	subscriptions: Map<string, { count: number; sub: Subscription }>;
	options: Partial<Options>;
};

/**
 * SharedCentrifuge manages a single Centrifuge WebSocket connection that can be shared
 * across multiple instances. It handles reference counting for both connections and subscriptions,
 * ensuring resources are cleaned up when no longer needed.
 *
 * Key concepts:
 * - One Centrifuge connection per WebSocket URL, shared across all SharedCentrifuge instances
 * - Subscriptions are reference-counted: multiple instances can subscribe to the same channel
 * - Each instance tracks its own subscriptions and can disconnect independently
 * - The underlying connection stays alive until all instances for that URL disconnect
 *
 * Why is this useful? It allows the consumer to reuse a single Centrifuge connection under the hood,
 * while providing an API that acts like an instance of Centrifuge.
 */
export class SharedCentrifuge extends EventEmitter {
	/**
	 * Global contexts shared across all SharedCentrifuge instances.
	 */
	private static contexts: Map<string, Context> = new Map();

	/**
	 * Per Instance variables.
	 */
	private readonly url: string;
	private channels: Set<string> = new Set();
	private disconnected: boolean = false;
	private eventListeners: Map<string, (...args: unknown[]) => void> = new Map();

	constructor(url: string, opts: Partial<Options> = {}) {
		super();
		this.url = url;

		// Initialize shared state for this URL if it doesn't exist
		if (!SharedCentrifuge.contexts.has(url)) {
			const centrifuge = new Centrifuge(url, opts);
			SharedCentrifuge.contexts.set(url, {
				centrifuge,
				refcount: 0,
				subscriptions: new Map(),
				options: opts,
			});
		} else {
			const context = SharedCentrifuge.contexts.get(url);
			if (!context) throw new Error("No context found");
			this.validateOptions(context.options, opts);
		}

		const context = SharedCentrifuge.contexts.get(url);
		if (!context) throw new Error("No context found");
		context.refcount++;

		this.attachEventListeners();
	}

	/**
	 * Connect to the Centrifuge server.
	 */
	connect(): void {
		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) return;

		// If already connected, emit connected event immediately
		if (context.centrifuge.state === "connected") {
			setImmediate(() => this.emit("connected"));
		} else if (context.centrifuge.state === "connecting") {
			// Already connecting, event will be emitted when connection completes
		} else {
			context.centrifuge.connect();
		}
	}

	/**
	 * Disconnect from the Centrifuge server.
	 */
	disconnect(): Promise<void> {
		if (this.disconnected) return Promise.resolve();

		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) return Promise.resolve();

		this.disconnected = true;
		this.emit("disconnected");
		this.detachEventListeners();
		for (const channel of this.channels) this.decrementChannelRef(channel);
		this.channels.clear();
		context.refcount--;

		// If this was the last instance, clean up the shared Centrifuge
		if (context.refcount === 0) {
			return new Promise((resolve) => {
				context.centrifuge.once("disconnected", () => {
					SharedCentrifuge.contexts.delete(this.url);
					resolve();
				});
				context.centrifuge.disconnect();
			});
		}

		return Promise.resolve();
	}

	/**
	 * Create or get an existing subscription to a channel.
	 * Returns a subscription proxy that manages the subscription lifecycle
	 * and ensures proper reference counting for resource cleanup.
	 */
	newSubscription(channel: string, opts: Partial<SubscriptionOptions> = {}): ISubscription {
		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) throw new Error("No context found");

		const subs = context.subscriptions;

		// Only increment global reference count if this instance hasn't subscribed to this channel before
		if (!this.channels.has(channel)) {
			if (!subs.has(channel)) {
				const realSub = context.centrifuge.newSubscription(channel, opts);
				subs.set(channel, { count: 1, sub: realSub });
			} else {
				const subInfo = subs.get(channel);
				if (!subInfo) throw new Error(`Failed to get subscription info for channel ${channel}`);
				subInfo.count++;
			}
		}

		this.channels.add(channel);
		const subInfo = subs.get(channel);
		if (!subInfo) throw new Error(`Failed to create or get subscription for channel ${channel}`);
		return new SubscriptionProxy(subInfo.sub, this);
	}

	/**
	 * Get an existing subscription to a channel if it exists.
	 * Returns undefined if no subscription exists for the channel.
	 */
	getSubscription(channel: string): ISubscription | undefined {
		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) return undefined;

		const subInfo = context.subscriptions.get(channel);
		return subInfo ? new SubscriptionProxy(subInfo.sub, this) : undefined;
	}

	/**
	 * Publish data to a channel.
	 */
	async publish(channel: string, data: unknown): Promise<void> {
		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) return;

		await context.centrifuge.publish(channel, data);
	}

	/**
	 * Get all current subscriptions as proxied objects.
	 */
	subscriptions(): Record<string, ISubscription> {
		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) return {};

		const subs = context.centrifuge.subscriptions();
		const proxiedSubs: Record<string, ISubscription> = {};
		for (const channel in subs) {
			proxiedSubs[channel] = new SubscriptionProxy(subs[channel], this);
		}
		return proxiedSubs;
	}

	/** 
	 * Get the underlying Centrifuge instance (for testing purposes).
	 */
	get real(): Centrifuge | undefined {
		const context = SharedCentrifuge.contexts.get(this.url);
		return context?.centrifuge;
	}

	/**
	 * Get the current connection state. Returns "disconnected" if this instance has been disconnected.
	 */
	get state(): string {
		if (this.disconnected) return "disconnected";
		const context = SharedCentrifuge.contexts.get(this.url);
		return context?.centrifuge.state ?? "disconnected";
	}

	/**
	 * Attach event listeners for this specific instance.
	 */
	private attachEventListeners(): void {
		if (this.eventListeners.size > 0) return;

		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) return;

		const events = ["connecting", "connected", "disconnected", "error"];

		events.forEach((event) => {
			const listener = (ctx?: unknown): void => {
				// Don't emit events if this instance has been disconnected
				if (!this.disconnected) this.emit(event, ctx);
			};
			this.eventListeners.set(event, listener);
			context.centrifuge.on(event as keyof ClientEvents, listener);
		});
	}

	/**
	 * Decrement the reference count for a channel subscription.
	 */
	private decrementChannelRef(channel: string): void {
		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) return;

		const subs = context.subscriptions;
		const subInfo = subs.get(channel);
		if (!subInfo) return;

		subInfo.count--;
		if (subInfo.count === 0) {
			context.centrifuge.removeSubscription(subInfo.sub);
			subs.delete(channel);
		}
	}

	/**
	 * Detach event listeners for this specific instance.
	 */
	private detachEventListeners(): void {
		const context = SharedCentrifuge.contexts.get(this.url);
		if (!context) return;

		for (const [event, listener] of this.eventListeners) {
			context.centrifuge.off(event as keyof ClientEvents, listener);
		}
		this.eventListeners.clear();
	}

	/**
	 * Validate that provided options match the existing shared state's options.
	 */
	private validateOptions(existingOpts: Partial<Options>, newOpts: Partial<Options>): void {
		const criticalKeys: (keyof Options)[] = ["token", "websocket", "minReconnectDelay", "maxReconnectDelay"];

		for (const key of criticalKeys) {
			const existing = existingOpts[key];
			const incoming = newOpts[key];

			// Only warn if both values are defined and different
			if (existing !== undefined && incoming !== undefined && existing !== incoming) {
				console.warn(`SharedCentrifuge: Option '${key}' mismatch for URL ${this.url}. Using existing value: ${existing}, ignoring new value: ${incoming}`);
			}
		}
	}

	/**
	 * Remove a subscription, cleaning up resources if no instances are using it.
	 * This decrements reference counts and removes subscriptions when they
	 * reach zero references across all instances.
	 */
	removeSubscription(sub: ISubscription): void {
		if (!sub || !sub.channel) return;
		this.decrementChannelRef(sub.channel);
		this.channels.delete(sub.channel);
	}
}
