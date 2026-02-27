/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import { v4 as uuid } from "uuid";
import * as t from "vitest";
import WebSocket from "ws";
import type { IKVStore } from "../../domain/kv-store";
import { WebSocketTransport } from ".";

const WEBSOCKET_URL = "ws://localhost:8000/connection/websocket";

const testModes = [
	{ name: "Shared Centrifuge Client", useSharedConnection: true },
	{ name: "Single Centrifuge Client", useSharedConnection: false },
];

/**
 * Simple in-memory KV store implementation for testing.
 */
class InMemoryKVStore implements IKVStore {
	private store = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		return this.store.get(key) || null;
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}
}

interface Emitter {
	once(event: string | symbol, listener: (...args: any[]) => void): this;
}

const waitFor = (emitter: Emitter, event: string): Promise<any> => {
	return new Promise((resolve) => emitter.once(event, resolve));
};

t.describe.each(testModes)("WebSocketTransport with $name", ({ useSharedConnection }) => {
	t.describe("Constructor and Initialization", () => {
		t.test("should create an instance of WebSocketTransport", async () => {
			const transport = await WebSocketTransport.create({
				url: WEBSOCKET_URL,
				kvstore: new InMemoryKVStore(),
				websocket: WebSocket,
				useSharedConnection,
			});
			t.expect(transport).toBeInstanceOf(WebSocketTransport);
		});

		t.test('should have initial state as "disconnected"', async () => {
			const transport = await WebSocketTransport.create({
				kvstore: new InMemoryKVStore(),
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			t.expect((transport as any).state).toBe("disconnected");
		});
	});

	t.describe("Connection Management", () => {
		let transport: WebSocketTransport;
		let kvstore: InMemoryKVStore;

		t.beforeEach(async () => {
			kvstore = new InMemoryKVStore();
			transport = await WebSocketTransport.create({
				kvstore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
		});

		t.afterEach(async () => {
			// Ensure we disconnect after each test to avoid interference
			await transport.disconnect();
		});

		t.test("should transition through connecting to connected state on connect()", async () => {
			const connectingPromise = waitFor(transport, "connecting");
			const connectedPromise = waitFor(transport, "connected");

			const connectPromise = transport.connect();

			// Immediately after calling connect, state should be "connecting"
			t.expect((transport as any).state).toBe("connecting");
			await connectingPromise;

			await connectedPromise;
			t.expect((transport as any).state).toBe("connected");

			await t.expect(connectPromise).resolves.toBeUndefined();
		});

		t.test("should resolve immediately if connect() is called when already connected", async () => {
			await transport.connect();
			t.expect((transport as any).state).toBe("connected");

			// This should resolve without creating a new connection.
			await t.expect(transport.connect()).resolves.toBeUndefined();
		});

		t.test("should resolve if connect() is called while already connecting", async () => {
			const connectPromise1 = transport.connect();
			t.expect((transport as any).state).toBe("connecting");

			const connectPromise2 = transport.connect();

			await t.expect(connectPromise1).resolves.toBeUndefined();
			await t.expect(connectPromise2).resolves.toBeUndefined();
			t.expect((transport as any).state).toBe("connected");
		});

		t.test("should disconnect from a connected state", async () => {
			await transport.connect();
			t.expect((transport as any).state).toBe("connected");

			const disconnectedPromise = waitFor(transport, "disconnected");
			const disconnectPromise = transport.disconnect();

			await disconnectedPromise;
			t.expect((transport as any).state).toBe("disconnected");
			await t.expect(disconnectPromise).resolves.toBeUndefined();
		});

		t.test("should resolve immediately if disconnect() is called when already disconnected", async () => {
			t.expect((transport as any).state).toBe("disconnected");
			await t.expect(transport.disconnect()).resolves.toBeUndefined();
		});
	});

	t.describe("Subscription Management", () => {
		let transport: WebSocketTransport;
		let kvstore: InMemoryKVStore;
		let channel: string;

		t.beforeEach(async () => {
			// Generate a unique channel for each test
			channel = `session:${uuid()}`;

			kvstore = new InMemoryKVStore();
			transport = await WebSocketTransport.create({
				kvstore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			await transport.connect();
		});

		t.afterEach(async () => {
			await transport.disconnect();
		});

		t.test("should subscribe to a new channel", async () => {
			await t.expect(transport.subscribe(channel)).resolves.toBeUndefined();
		});

		t.test("should resolve immediately if already subscribed to a channel", async () => {
			await transport.subscribe(channel); // First time
			await t.expect(transport.subscribe(channel)).resolves.toBeUndefined(); // Second time
		});

		t.test("should receive a message on a subscribed channel", async () => {
			await transport.subscribe(channel);

			// Use a second transport to publish a message
			const publisherKVStore = new InMemoryKVStore();
			const publisher = await WebSocketTransport.create({
				kvstore: publisherKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			await publisher.connect();
			await publisher.subscribe(channel); // Publisher needs to subscribe before publishing

			const payload = `message from publisher ${Date.now()}`;
			const messagePromise = waitFor(transport, "message");

			// The publisher transport will wrap this payload in an envelope.
			await publisher.publish(channel, payload);

			const received = await messagePromise;

			// The subscriber transport should unwrap the envelope and emit the original payload.
			t.expect(received).toMatchObject({ channel, data: payload });
			t.expect(received.confirmNonce).toBeTypeOf("function");

			await publisher.disconnect();
		});

		t.test("should not attach duplicate event listeners on repeated subscribe calls", async () => {
			await transport.subscribe(channel);

			// Set up a counter to track how many times the message handler is called
			let messageCount = 0;
			transport.on("message", () => {
				messageCount++;
			});

			// Subscribe to the same channel again (should not attach new listeners)
			await transport.subscribe(channel);

			// Publish a single message using the publisher
			const publisherKVStore = new InMemoryKVStore();
			const publisher = await WebSocketTransport.create({
				kvstore: publisherKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			await publisher.connect();
			await publisher.subscribe(channel);

			const payload = `test-message-${Date.now()}`;
			const messagePromise = waitFor(transport, "message");

			await publisher.publish(channel, payload);
			await messagePromise;

			// Wait a bit to ensure no duplicate messages arrive
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Should only receive the message once, not twice
			t.expect(messageCount).toBe(1);

			await publisher.disconnect();
		});

		t.test("should not call _fetchHistory multiple times on repeated subscribe", async () => {
			const fetchHistorySpy = t.vi.spyOn(transport as any, "_fetchHistory");

			// First subscribe - should call _fetchHistory
			await transport.subscribe(channel);
			t.expect(fetchHistorySpy).toHaveBeenCalledTimes(1);

			// Second subscribe to same channel - should NOT call _fetchHistory again
			await transport.subscribe(channel);
			t.expect(fetchHistorySpy).toHaveBeenCalledTimes(1); // Still 1, not 2

			fetchHistorySpy.mockRestore();
		});
	});

	t.describe("Message Publishing and Queuing", () => {
		let publisher: WebSocketTransport;
		let subscriber: WebSocketTransport;
		let publisherKVStore: InMemoryKVStore;
		let subscriberKVStore: InMemoryKVStore;
		let channel: string;

		t.beforeEach(async () => {
			// Generate a unique channel for each test
			channel = `session:${uuid()}`;

			publisherKVStore = new InMemoryKVStore();
			subscriberKVStore = new InMemoryKVStore();

			publisher = await WebSocketTransport.create({
				kvstore: publisherKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			subscriber = await WebSocketTransport.create({
				kvstore: subscriberKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});

			// Subscriber must be connected and subscribed to receive messages
			await subscriber.connect();
			await subscriber.subscribe(channel);
		});

		t.afterEach(async () => {
			await publisher.disconnect();
			await subscriber.disconnect();
		});

		t.test("should queue a message when disconnected and send it after connecting", async () => {
			const payload = "queued-message";
			const messagePromise = waitFor(subscriber, "message");

			// Publish while disconnected, the promise should be pending
			const publishPromise = publisher.publish(channel, payload);

			// Now connect the publisher and subscribe to the channel
			await publisher.connect();
			await publisher.subscribe(channel);

			// The promise should now resolve with true, and the message should be received
			await t.expect(publishPromise).resolves.toBe(true);
			const received = await messagePromise;
			t.expect(received.data).toBe(payload);
		});

		t.test("should queue a message when connecting and send it after connection is established", async () => {
			const payload = "queued-while-connecting";
			const messagePromise = waitFor(subscriber, "message");

			// Start connecting the publisher
			const connectPromise = publisher.connect();
			// With SharedCentrifuge, if connection is already established, it may jump straight to "connected"
			t.expect(["connecting", "connected"]).toContain((publisher as any).state);

			// Publish while the connection is in progress (or immediately after if already connected)
			const publishPromise = publisher.publish(channel, payload);

			await connectPromise;
			await publisher.subscribe(channel); // Publisher needs to subscribe before publishing

			await t.expect(publishPromise).resolves.toBe(true);
			const received = await messagePromise;
			t.expect(received.data).toBe(payload);
		});

		t.test("should process multiple queued messages serially in order", async () => {
			const payloads = ["message 1", "message 2", "message 3"];
			const receivedMessages: string[] = [];

			const messagesReceivedPromise = new Promise<void>((resolve) => {
				const handler = ({ data }: { data: string }) => {
					receivedMessages.push(data);
					if (receivedMessages.length === payloads.length) {
						subscriber.off("message", handler);
						resolve();
					}
				};
				subscriber.on("message", handler);
			});

			// Queue up all messages while disconnected
			const publishPromises = payloads.map((p) => publisher.publish(channel, p));

			// Connect to trigger sending the queue
			await publisher.connect();
			await publisher.subscribe(channel);
			await Promise.all(publishPromises); // Wait for all publish promises to resolve

			await messagesReceivedPromise; // Wait for all messages to be received

			t.expect(receivedMessages).toEqual(payloads);
		});

		t.test("should send a message immediately when connected", async () => {
			await publisher.connect();
			await publisher.subscribe(channel);
			const payload = "instant-message";
			const messagePromise = waitFor(subscriber, "message");

			await publisher.publish(channel, payload);

			const received = await messagePromise;
			t.expect(received.data).toBe(payload);
		});

		t.test("should resolve queued messages with false on disconnect", async () => {
			const publishPromise = publisher.publish(channel, "this will be cancelled");

			// Disconnecting while a message is in the queue should cause its promise to resolve with false.
			await publisher.disconnect();

			await t.expect(publishPromise).resolves.toBe(false);
		});
	});

	t.describe("Incoming Message Handling and Persistence", () => {
		const transports: WebSocketTransport[] = [];
		let subscriber: WebSocketTransport;
		let rawPublisher: WebSocketTransport;
		let subscriberKVStore: InMemoryKVStore;
		let rawPublisherKVStore: InMemoryKVStore;
		let channel: string;

		t.beforeEach(async () => {
			// Generate a unique channel for each test
			channel = `session:${uuid()}`;

			subscriberKVStore = new InMemoryKVStore();
			rawPublisherKVStore = new InMemoryKVStore();

			subscriber = await WebSocketTransport.create({
				kvstore: subscriberKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			rawPublisher = await WebSocketTransport.create({
				kvstore: rawPublisherKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});

			transports.push(subscriber, rawPublisher);

			await subscriber.connect();
			await rawPublisher.connect();
			await subscriber.subscribe(channel);
		});

		t.afterEach(async () => {
			await Promise.all(transports.map((t) => t.disconnect()));
			transports.length = 0;
		});

		t.test("should ignore its own published messages", async () => {
			let messageReceived = false;
			subscriber.on("message", () => {
				messageReceived = true;
			});

			// Publish a message on the channel this transport is subscribed to.
			// The transport should ignore this message because it originated from itself.
			await subscriber.publish(channel, "this-should-be-ignored");

			// Wait a short moment to ensure the message is not processed.
			await new Promise((resolve) => setTimeout(resolve, 200));

			t.expect(messageReceived).toBe(false);
		});

		t.test("should deduplicate messages from other clients using persistent storage", async () => {
			const messagePayload = "dedup-test-message";
			let messageCount = 0;

			subscriber.on("message", ({ data, confirmNonce }) => {
				if (data === messagePayload) {
					messageCount++;
					confirmNonce?.();
				}
			});

			// Send the message once using normal publish
			const firstMessagePromise = waitFor(subscriber, "message");
			await rawPublisher.publish(channel, messagePayload);
			const firstMsg = await firstMessagePromise;
			await firstMsg.confirmNonce?.();
			t.expect(messageCount).toBe(1);

			// Create the exact same message envelope that was sent
			const clientId = (rawPublisher as any).storage.getClientId();
			const duplicateMessage = {
				clientId: clientId,
				nonce: 1, // Same nonce as the first message
				payload: messagePayload,
			};

			// Simulate disconnect and reconnect (restart scenario)
			await subscriber.disconnect();
			const newSubscriber = await WebSocketTransport.create({
				kvstore: subscriberKVStore, // Same storage
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			transports.push(newSubscriber);

			newSubscriber.on("message", ({ data }) => {
				if (data === messagePayload) {
					messageCount++;
				}
			});

			await newSubscriber.connect();
			await newSubscriber.subscribe(channel);

			// Send the exact same message again (same nonce) using raw centrifuge publish
			const rawMessage = JSON.stringify(duplicateMessage);
			await (rawPublisher as any).centrifuge.publish(channel, rawMessage);

			// Wait a bit to ensure the duplicate is not processed
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Should still be 1 because the duplicate message should be ignored
			t.expect(messageCount).toBe(1);
		});

		t.test('should emit an "error" for malformed JSON', async () => {
			const errorPromise = waitFor(subscriber, "error");

			// Publish a string that is not valid JSON
			await (rawPublisher as any).centrifuge.publish(channel, '{ "bad" "json" }');

			const error = await errorPromise;
			t.expect(error).toBeInstanceOf(Error);
			t.expect(error.message).toContain("Failed to parse incoming message");
		});

		t.test('should emit an "error" for an invalid message structure', async () => {
			const errorPromise = waitFor(subscriber, "error");

			// Publish valid JSON that does not match the TransportMessage structure
			const invalidMessage = JSON.stringify({ not_a_nonce: 1, not_a_payload: "hello" });
			await (rawPublisher as any).centrifuge.publish(channel, invalidMessage);

			const error = await errorPromise;
			t.expect(error).toBeInstanceOf(Error);
			t.expect(error.message).toContain("Failed to parse incoming message");
		});

		t.test("should fetch history for new WebSocketTransport instances after shared subscription disconnects", async () => {
			const channel = `session:${uuid()}`;
			const kvstoreA = new InMemoryKVStore();
			const kvstoreB = new InMemoryKVStore();

			// Create first transport and publish some messages
			const transportA = await WebSocketTransport.create({
				kvstore: kvstoreA,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			await transportA.connect();
			await transportA.subscribe(channel);

			const payloads = ["history-1", "history-2", "history-3"];
			for (const payload of payloads) {
				await transportA.publish(channel, payload);
			}

			// Wait a bit for messages to be published
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Disconnect the first transport to ensure messages are in history
			await transportA.disconnect();

			// Create second transport with different kvstore (simulating different wallet instance)
			const transportB = await WebSocketTransport.create({
				kvstore: kvstoreB,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});

			// Collect messages received by the second transport
			const receivedMessages: string[] = [];
			transportB.on("message", ({ data }) => {
				receivedMessages.push(data);
			});

			await transportB.connect();
			await transportB.subscribe(channel); // This should fetch history

			// Wait for history to be fetched
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Should have received the historical messages
			t.expect(receivedMessages).toEqual(payloads);

			await transportB.disconnect();
		});

		t.test("should handle multiple transport instances with independent per-channel nonces", async () => {
			// Create two different channels to simulate wallet connecting to multiple dApps
			const channelA = `session:${uuid()}`;
			const channelB = `session:${uuid()}`;

			// Create a second publisher with the same kvstore (simulating same wallet)
			const publisher2 = await WebSocketTransport.create({
				kvstore: rawPublisherKVStore, // Same kvstore as rawPublisher
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			transports.push(publisher2);
			await publisher2.connect();

			// Create second subscriber for channel B
			const subscriber2KVStore = new InMemoryKVStore();
			const subscriber2 = await WebSocketTransport.create({
				kvstore: subscriber2KVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			transports.push(subscriber2);
			await subscriber2.connect();
			await subscriber2.subscribe(channelB);

			// Subscribe the first subscriber to channelA
			await subscriber.subscribe(channelA);

			// Send messages on both channels
			const messageA = waitFor(subscriber, "message");
			const messageB = waitFor(subscriber2, "message");

			await rawPublisher.publish(channelA, "message-on-A");
			await publisher2.publish(channelB, "message-on-B");

			const receivedA = await messageA;
			const receivedB = await messageB;

			t.expect(receivedA.data).toBe("message-on-A");
			t.expect(receivedB.data).toBe("message-on-B");
		});
	});

	t.describe("Resilience and Recovery", () => {
		const transports: WebSocketTransport[] = [];

		t.afterEach(async () => {
			// Disconnect all transports created during a test
			await Promise.all(transports.map((transport) => transport.disconnect()));
			// Clear transports after each test
			transports.length = 0;
		});

		t.test("should receive historical messages upon subscribing in FIFO order", async () => {
			const channel = `session:${uuid()}`;
			const historicalPublisherKVStore = new InMemoryKVStore();
			const historicalPublisher = await WebSocketTransport.create({
				kvstore: historicalPublisherKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			transports.push(historicalPublisher);
			await historicalPublisher.connect();

			const payloads = ["history-1", "history-2", "history-3"];
			for (const payload of payloads) {
				await historicalPublisher.publish(channel, payload);
			}
			await historicalPublisher.disconnect(); // Disconnect to ensure messages are in history

			// Now, create a new subscriber
			const subscriberKVStore = new InMemoryKVStore();
			const subscriber = await WebSocketTransport.create({
				kvstore: subscriberKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			transports.push(subscriber);

			const receivedMessages: string[] = [];
			const messagesReceivedPromise = new Promise<void>((resolve) => {
				const handler = ({ data }: { data: string }) => {
					receivedMessages.push(data);
					if (receivedMessages.length === payloads.length) {
						subscriber.off("message", handler);
						resolve();
					}
				};
				subscriber.on("message", handler);
			});

			await subscriber.connect();
			await subscriber.subscribe(channel); // This should trigger history fetch

			await messagesReceivedPromise;

			t.expect(receivedMessages).toEqual(payloads);
		});

		t.test("should reject publish promise if publishing fails after all retries", async () => {
			const channel = `session:${uuid()}`;
			const publisherKVStore = new InMemoryKVStore();
			const publisher = await WebSocketTransport.create({
				kvstore: publisherKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			transports.push(publisher);
			await publisher.connect();

			const publishSpy = t.vi.spyOn((publisher as any).centrifuge, "publish").mockRejectedValue(new Error("Publication failed"));

			const publishPromise = publisher.publish(channel, "a-message");

			await t.expect(publishPromise).rejects.toThrow("Publication failed");

			// MAX_RETRY_ATTEMPTS is 5 in websocket.ts
			t.expect(publishSpy).toHaveBeenCalledTimes(5);

			publishSpy.mockRestore();
		});
	});

	t.describe("Channel Cleanup", () => {
		let transport: WebSocketTransport;
		let kvstore: InMemoryKVStore;
		let channel: string;

		t.beforeEach(async () => {
			// Generate a unique channel for each test
			channel = `session:${uuid()}`;

			kvstore = new InMemoryKVStore();
			transport = await WebSocketTransport.create({
				kvstore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			await transport.connect();
		});

		t.afterEach(async () => {
			await transport.disconnect();
		});

		t.test("should clear channel storage and subscription", async () => {
			// Subscribe to the channel and generate some storage data
			await transport.subscribe(channel);
			await transport.publish(channel, "test-message");

			// Wait a moment for publish to complete
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Verify subscription exists
			t.expect((transport as any).centrifuge.getSubscription(channel)).not.toBeUndefined();

			// Verify storage has data (check storage directly)
			const storage = (transport as any).storage;
			const nonceKey = storage.getNonceKey(channel);
			const latestNoncesKey = storage.getLatestNoncesKey(channel);

			// Should have nonce data from publishing
			t.expect(await kvstore.get(nonceKey)).not.toBeNull();

			// Clear the channel
			await transport.clear(channel);

			// Verify subscription is removed
			t.expect((transport as any).centrifuge.getSubscription(channel)).toBeFalsy();

			// Verify storage is cleared
			t.expect(await kvstore.get(nonceKey)).toBeNull();
			t.expect(await kvstore.get(latestNoncesKey)).toBeNull();
		});

		t.test("should clear only the specified channel subscription", async () => {
			const channelA = `session:${uuid()}`;
			const channelB = `session:${uuid()}`;

			// Subscribe to both channels
			await transport.subscribe(channelA);
			await transport.subscribe(channelB);

			// Verify both subscriptions exist
			t.expect((transport as any).centrifuge.getSubscription(channelA)).not.toBeUndefined();
			t.expect((transport as any).centrifuge.getSubscription(channelB)).not.toBeUndefined();

			// Clear only channel A
			await transport.clear(channelA);

			// Verify only channel A subscription is removed
			t.expect((transport as any).centrifuge.getSubscription(channelA)).toBeFalsy();
			t.expect((transport as any).centrifuge.getSubscription(channelB)).not.toBeUndefined();
		});

		t.test("should handle clearing non-subscribed channel gracefully", async () => {
			const nonSubscribedChannel = `session:${uuid()}`;

			// This should not throw an error
			await t.expect(transport.clear(nonSubscribedChannel)).resolves.toBeUndefined();

			// Verify it doesn't affect existing subscriptions
			await transport.subscribe(channel);
			t.expect((transport as any).centrifuge.getSubscription(channel)).not.toBeUndefined();

			await transport.clear(nonSubscribedChannel);
			t.expect((transport as any).centrifuge.getSubscription(channel)).not.toBeUndefined();
		});

		t.test("should clear channel with existing message history", async () => {
			// Create another transport to send messages
			const publisherKVStore = new InMemoryKVStore();
			const publisher = await WebSocketTransport.create({
				kvstore: publisherKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			await publisher.connect();

			// Subscribe and receive some messages to build up history
			await transport.subscribe(channel);

			const messagePromises: Promise<any>[] = [];
			for (let i = 0; i < 3; i++) {
				messagePromises.push(waitFor(transport, "message"));
				await publisher.publish(channel, `message-${i}`);
			}

			// Wait for all messages to be received and confirm nonces so they persist
			const receivedMsgs = await Promise.all(messagePromises);
			for (const msg of receivedMsgs) {
				await msg.confirmNonce?.();
			}

			// Verify storage has accumulated data
			const storage = (transport as any).storage;
			const latestNonces = await storage.getLatestNonces(channel);
			t.expect(latestNonces.size).toBeGreaterThan(0);

			// Clear the channel
			await transport.clear(channel);

			// Verify all storage is cleared
			const clearedLatestNonces = await storage.getLatestNonces(channel);
			t.expect(clearedLatestNonces.size).toBe(0);

			await publisher.disconnect();
		});

		t.test("should allow resubscribing to a cleared channel", async () => {
			// Subscribe, clear, then resubscribe
			await transport.subscribe(channel);
			await transport.clear(channel);

			// This should work without issues
			await t.expect(transport.subscribe(channel)).resolves.toBeUndefined();
			t.expect((transport as any).centrifuge.getSubscription(channel)).not.toBeUndefined();

			// Should be able to receive messages on the resubscribed channel
			const publisherKVStore = new InMemoryKVStore();
			const publisher = await WebSocketTransport.create({
				kvstore: publisherKVStore,
				url: WEBSOCKET_URL,
				websocket: WebSocket,
				useSharedConnection,
			});
			await publisher.connect();

			const messagePromise = waitFor(transport, "message");
			await publisher.publish(channel, "resubscribe-test");
			const received = await messagePromise;

			t.expect(received.data).toBe("resubscribe-test");
			await publisher.disconnect();
		});
	});
});
