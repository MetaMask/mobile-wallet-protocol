import {
	Centrifuge,
	type ErrorContext,
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
import { ErrorCode, TransportError } from "../../domain/errors";

export interface ISubscription extends EventEmitter {
	readonly channel: string;
	readonly state: string;
	subscribe(): void;
	unsubscribe(): void;
	// biome-ignore lint/suspicious/noExplicitAny: to match centrifuge-js interface
	publish(data: any): Promise<PublishResult>;
	history(options: HistoryOptions): Promise<HistoryResult>;
}

class SubscriptionProxy extends EventEmitter implements ISubscription {
	constructor(public readonly realSub: Subscription) {
		super();
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
	}
	// biome-ignore lint/suspicious/noExplicitAny: to match centrifuge-js interface
	async publish(data: any): Promise<PublishResult> {
		return await this.realSub.publish(data);
	}
	history(options: HistoryOptions): Promise<HistoryResult> {
		return this.realSub.history(options);
	}
}

export class SharedCentrifuge extends EventEmitter {
	private static instances: Map<string, Centrifuge> = new Map();
	private static refCounts: Map<string, number> = new Map();
	private static subRefs: Map<string, Map<string, { count: number; sub: Subscription }>> = new Map();
	private static eventProxies: Map<string, EventEmitter> = new Map();
	private static eventListenersSetup: Set<string> = new Set();

	private readonly url: string;
	private readonly real: Centrifuge;
	private readonly eventProxy: EventEmitter;
	private myChannels: Set<string> = new Set();
	private myState: "disconnected" | "connecting" | "connected" = "disconnected";
	// biome-ignore lint/suspicious/noExplicitAny: for generic event listeners
	private eventListeners: Map<string, (...args: any[]) => void> = new Map();

	constructor(url: string, opts: Partial<Options> = {}) {
		super();
		this.url = url;

		if (!SharedCentrifuge.instances.has(url)) {
			const real = new Centrifuge(url, opts);
			SharedCentrifuge.instances.set(url, real);
			SharedCentrifuge.refCounts.set(url, 0);
			SharedCentrifuge.subRefs.set(url, new Map());
			SharedCentrifuge.eventProxies.set(url, new EventEmitter());
		}
		const realInstance = SharedCentrifuge.instances.get(url);
		const eventProxy = SharedCentrifuge.eventProxies.get(url);
		if (!realInstance || !eventProxy) {
			throw new Error("Failed to get or create Centrifuge instance");
		}
		this.real = realInstance;
		this.eventProxy = eventProxy;

		const count = SharedCentrifuge.refCounts.get(this.url) ?? 0;
		SharedCentrifuge.refCounts.set(this.url, count + 1);

		// Set up global event listeners only once per URL
		if (!SharedCentrifuge.eventListenersSetup.has(url)) {
			this.setupGlobalEventListeners();
			SharedCentrifuge.eventListenersSetup.add(url);
		}

		this.attachEventListeners();

		// Sync initial state with real client
		if (this.real.state === "connected") {
			this.myState = "connected";
			// Emit connected event for instances joining an already-connected client
			setImmediate(() => this.emit("connected"));
		} else if (this.real.state === "connecting") {
			this.myState = "connecting";
		}
	}

	private setupGlobalEventListeners(): void {
		const events = ["connecting", "connected", "disconnected", "error"];
		events.forEach((event) => {
			// biome-ignore lint/suspicious/noExplicitAny: context type varies per event
			const listener = (ctx?: any): void => {
				// Forward events through the event proxy
				this.eventProxy.emit(event, ctx);
			};
			// biome-ignore lint/suspicious/noExplicitAny: event string is correct
			this.real.on(event as any, listener);
		});
	}

	private attachEventListeners(): void {
		if (this.eventListeners.size > 0) return;
		const events = ["connecting", "connected", "disconnected", "error"];
		events.forEach((event) => {
			// biome-ignore lint/suspicious/noExplicitAny: context type varies per event
			const listener = (ctx?: any): void => {
				// Update local state based on events
				if (event === "connecting") this.myState = "connecting";
				else if (event === "connected") this.myState = "connected";
				else if (event === "disconnected" && this.myState !== "disconnected") {
					// Only update to disconnected if we haven't already marked ourselves as disconnected
					this.myState = "disconnected";
				}
				this.emit(event, ctx);
			};
			this.eventListeners.set(event, listener);
			// Listen to the event proxy instead of the real client
			this.eventProxy.on(event, listener);
		});
	}

	private detachEventListeners(): void {
		for (const [event, listener] of this.eventListeners) {
			// Remove listener from event proxy
			this.eventProxy.off(event, listener);
		}
		this.eventListeners.clear();
	}

	get state(): string {
		return this.myState;
	}

	connect(): void {
		if (this.myState === "disconnected") {
			// Check if real client is already connected
			if (this.real.state === "connected") {
				this.myState = "connected";
				setImmediate(() => this.emit("connected"));
			} else if (this.real.state === "connecting") {
				this.myState = "connecting";
				// The event proxy will emit the connected event when ready
			} else {
				this.myState = "connecting";
				this.real.connect();
			}
		}
	}

	disconnect(): Promise<void> {
		// Mark this instance as disconnected immediately
		this.myState = "disconnected";

		// Emit disconnected event BEFORE detaching listeners
		setImmediate(() => this.emit("disconnected"));

		// Clean up after emitting the event
		setImmediate(() => {
			this.detachEventListeners();
		});

		for (const channel of this.myChannels) {
			this.decrementChannelRef(channel);
		}
		this.myChannels.clear();

		const currentCount = SharedCentrifuge.refCounts.get(this.url);
		if (currentCount === undefined) return Promise.resolve();

		const count = currentCount - 1;
		SharedCentrifuge.refCounts.set(this.url, count);

		if (count === 0) {
			return new Promise((resolve) => {
				this.real.once("disconnected", () => {
					SharedCentrifuge.instances.delete(this.url);
					SharedCentrifuge.refCounts.delete(this.url);
					SharedCentrifuge.subRefs.delete(this.url);
					SharedCentrifuge.eventProxies.delete(this.url);
					SharedCentrifuge.eventListenersSetup.delete(this.url);
					resolve();
				});
				this.real.disconnect();
			});
		}
		return Promise.resolve();
	}

	reconnect(): Promise<void> {
		this.real.disconnect();
		return new Promise((resolve, reject) => {
			this.real.once("connected", () => resolve());
			this.real.once("error", (ctx: ErrorContext) => reject(new TransportError(ErrorCode.TRANSPORT_RECONNECT_FAILED, ctx.error.message)));
			this.real.connect();
		});
	}

	newSubscription(channel: string, opts: Partial<SubscriptionOptions> = {}): ISubscription {
		const subMap = SharedCentrifuge.subRefs.get(this.url);
		if (!subMap) throw new Error("Subscription map not initialized");

		if (!subMap.has(channel)) {
			const realSub = this.real.newSubscription(channel, opts);
			subMap.set(channel, { count: 1, sub: realSub });
		} else {
			const subInfo = subMap.get(channel);
			if (subInfo) subInfo.count++;
		}
		this.myChannels.add(channel);
		const subInfo = subMap.get(channel);
		if (!subInfo) throw new Error(`Failed to create or get subscription for channel ${channel}`);
		return new SubscriptionProxy(subInfo.sub);
	}

	getSubscription(channel: string): ISubscription | undefined {
		const subInfo = SharedCentrifuge.subRefs.get(this.url)?.get(channel);
		return subInfo ? new SubscriptionProxy(subInfo.sub) : undefined;
	}

	removeSubscription(sub: ISubscription): void {
		if (!sub || !sub.channel) return;
		this.decrementChannelRef(sub.channel);
		this.myChannels.delete(sub.channel);
	}

	private decrementChannelRef(channel: string): void {
		const subMap = SharedCentrifuge.subRefs.get(this.url);
		if (!subMap || !subMap.has(channel)) return;
		const subInfo = subMap.get(channel);
		if (!subInfo) return;
		subInfo.count--;
		if (subInfo.count === 0) {
			this.real.removeSubscription(subInfo.sub);
			subMap.delete(channel);
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: to match centrifuge-js interface
	async publish(channel: string, data: any): Promise<void> {
		await this.real.publish(channel, data);
	}

	subscriptions(): Record<string, ISubscription> {
		const subs = this.real.subscriptions();
		const proxiedSubs: Record<string, ISubscription> = {};
		for (const channel in subs) {
			proxiedSubs[channel] = new SubscriptionProxy(subs[channel]);
		}
		return proxiedSubs;
	}
}
