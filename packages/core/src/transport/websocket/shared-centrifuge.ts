import {
	Centrifuge,
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
	constructor(public readonly realSub: Subscription, private readonly parent: SharedCentrifuge) {
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
 * SharedCentrifuge manages a single Centrifuge WebSocket connection that can be shared
 * across multiple instances. It handles reference counting for both connections and subscriptions,
 * ensuring resources are cleaned up when no longer needed.
 *
 * Key concepts:
 * - One Centrifuge connection per WebSocket URL, shared across all SharedCentrifuge instances
 * - Subscriptions are reference-counted: multiple instances can subscribe to the same channel
 * - Each instance tracks its own subscriptions and can disconnect independently
 * - The underlying connection stays alive until all instances for that URL disconnect
 */
export class SharedCentrifuge extends EventEmitter {
	/**
	 * Global state shared across all SharedCentrifuge instances per URL.
	 * Contains the actual Centrifuge client, reference counts, and subscription tracking.
	 */
	private static globalstate: Map<string, {
		centrifuge: Centrifuge;
		refCount: number;
		subscriptions: Map<string, { count: number; sub: Subscription }>;
		eventListenersAttached: boolean;
		options: Partial<Options>;
	}> = new Map();

	private readonly url: string;
	private channels: Set<string> = new Set();
	private disconnected: boolean = false;

	// biome-ignore lint/suspicious/noExplicitAny: for generic event listeners
	private eventListeners: Map<string, (...args: any[]) => void> = new Map();

	constructor(url: string, opts: Partial<Options> = {}) {
		super();
		this.url = url;

		// Initialize shared state for this URL if it doesn't exist
		if (!SharedCentrifuge.globalstate.has(url)) {
			const centrifuge = new Centrifuge(url, opts);
			SharedCentrifuge.globalstate.set(url, {
				centrifuge,
				refCount: 0,
				subscriptions: new Map(),
				eventListenersAttached: false, // Not used anymore, kept for future extension
				options: opts,
			});
		} else {
			// Validate options match for existing shared state
			const shared = SharedCentrifuge.globalstate.get(url)!;
			this.validateOptions(shared.options, opts);
		}

		const shared = SharedCentrifuge.globalstate.get(url);
		if (!shared) throw new Error("No shared state found");
		shared.refCount++;

		this.attachEventListeners();
	}

	/**
	 * Validate that provided options match the existing shared state's options.
	 */
	private validateOptions(existingOpts: Partial<Options>, newOpts: Partial<Options>): void {
		const criticalKeys: (keyof Options)[] = ['token', 'websocket', 'minReconnectDelay', 'maxReconnectDelay'];

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
	 * Attach event listeners for this specific instance.
	 */
	private attachEventListeners(): void {
		if (this.eventListeners.size > 0) return;

		const shared = SharedCentrifuge.globalstate.get(this.url)!;
		const events = ["connecting", "connected", "disconnected", "error"];

		events.forEach((event) => {
			// biome-ignore lint/suspicious/noExplicitAny: context type varies per event
			const listener = (ctx?: any): void => {
				// Don't emit events if this instance has been disconnected
				if (!this.disconnected) {
					this.emit(event, ctx);
				}
			};
			this.eventListeners.set(event, listener);
			shared.centrifuge.on(event as any, listener);
		});
	}

	/** Get the underlying Centrifuge instance (for testing purposes). */
	get real(): Centrifuge | undefined {
		const shared = SharedCentrifuge.globalstate.get(this.url);
		return shared?.centrifuge;
	}

	private detachEventListeners(): void {
		const shared = SharedCentrifuge.globalstate.get(this.url);
		if (!shared) return;

		for (const [event, listener] of this.eventListeners) {
			shared.centrifuge.off(event as any, listener);
		}
		this.eventListeners.clear();
	}

	/** Get the current connection state. Returns "disconnected" if this instance has been disconnected. */
	get state(): string {
		if (this.disconnected) return "disconnected";
		const shared = SharedCentrifuge.globalstate.get(this.url);
		return shared?.centrifuge.state ?? "disconnected";
	}

	/** Connect to the Centrifuge server. */
	connect(): void {
		const shared = SharedCentrifuge.globalstate.get(this.url);
		if (!shared) return;

		// If already connected, emit connected event immediately
		if (shared.centrifuge.state === "connected") {
			setImmediate(() => this.emit("connected"));
		} else if (shared.centrifuge.state === "connecting") {
			// Already connecting, event will be emitted when connection completes
		} else {
			shared.centrifuge.connect();
		}
	}

	/** Disconnect from the Centrifuge server. */
	disconnect(): Promise<void> {
		if (this.disconnected) return Promise.resolve();

		const shared = SharedCentrifuge.globalstate.get(this.url);
		if (!shared) return Promise.resolve();

		// Mark this instance as disconnected
		this.disconnected = true;

		// Emit disconnected event immediately for this instance
		this.emit("disconnected");

		// Clean up this instance's resources synchronously to prevent leaks
		this.detachEventListeners();

		// Clean up subscriptions for this instance
		for (const channel of this.channels) {
			this.decrementChannelRef(channel);
		}
		this.channels.clear();

		// Decrement reference count
		shared.refCount--;

		// If this was the last instance, clean up the shared Centrifuge
		if (shared.refCount === 0) {
			return new Promise((resolve) => {
				shared.centrifuge.once("disconnected", () => {
					SharedCentrifuge.globalstate.delete(this.url);
					resolve();
				});
				shared.centrifuge.disconnect();
			});
		}

		return Promise.resolve();
	}


	/** Create or get an existing subscription to a channel. */
	newSubscription(channel: string, opts: Partial<SubscriptionOptions> = {}): ISubscription {
		const shared = SharedCentrifuge.globalstate.get(this.url);
		if (!shared) throw new Error("No shared state found");

		const subs = shared.subscriptions;

		// Only increment global reference count if this instance hasn't subscribed to this channel before
		if (!this.channels.has(channel)) {
			if (!subs.has(channel)) {
				const realSub = shared.centrifuge.newSubscription(channel, opts);
				subs.set(channel, { count: 1, sub: realSub });
			} else {
				const subInfo = subs.get(channel)!;
				subInfo.count++;
			}
		}

		this.channels.add(channel);
		const subInfo = subs.get(channel);
		if (!subInfo) throw new Error(`Failed to create or get subscription for channel ${channel}`);
		return new SubscriptionProxy(subInfo.sub, this);
	}

	/** Get an existing subscription to a channel if it exists. */
	getSubscription(channel: string): ISubscription | undefined {
		const shared = SharedCentrifuge.globalstate.get(this.url);
		if (!shared) return undefined;

		const subInfo = shared.subscriptions.get(channel);
		return subInfo ? new SubscriptionProxy(subInfo.sub, this) : undefined;
	}

	/** Remove a subscription, cleaning up if no instances are using it. */
	removeSubscription(sub: ISubscription): void {
		if (!sub || !sub.channel) return;
		this.decrementChannelRef(sub.channel);
		this.channels.delete(sub.channel);
	}

	/** Decrement the reference count for a channel subscription. */
	private decrementChannelRef(channel: string): void {
		const shared = SharedCentrifuge.globalstate.get(this.url);
		if (!shared) return;

		const subs = shared.subscriptions;
		const subInfo = subs.get(channel);
		if (!subInfo) return;

		subInfo.count--;
		if (subInfo.count === 0) {
			shared.centrifuge.removeSubscription(subInfo.sub);
			subs.delete(channel);
		}
	}

	/** Publish data to a channel. */
	// biome-ignore lint/suspicious/noExplicitAny: to match centrifuge-js interface
	async publish(channel: string, data: any): Promise<void> {
		const shared = SharedCentrifuge.globalstate.get(this.url);
		if (!shared) return;

		await shared.centrifuge.publish(channel, data);
	}

	/** Get all current subscriptions as proxied objects. */
	subscriptions(): Record<string, ISubscription> {
		const shared = SharedCentrifuge.globalstate.get(this.url);
		if (!shared) return {};

		const subs = shared.centrifuge.subscriptions();
		const proxiedSubs: Record<string, ISubscription> = {};
		for (const channel in subs) {
			proxiedSubs[channel] = new SubscriptionProxy(subs[channel], this);
		}
		return proxiedSubs;
	}
}
