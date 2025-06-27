/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import type { EventEmitter } from 'node:events';
import * as t from 'vitest';
import WebSocket from 'ws';
import { WebSocketTransport } from './websocket';

const WEBSOCKET_URL = 'ws://localhost:8000/connection/websocket';

const waitFor = (emitter: EventEmitter, event: string): Promise<any> => {
	return new Promise(resolve => emitter.once(event, resolve));
};

t.describe('WebSocketTransport', () => {
	t.describe('Constructor and Initialization', () => {
		t.test('should create an instance of WebSocketTransport', () => {
			t.expect(() => new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket })).not.toThrow();
		});

		t.test('should have initial state as "disconnected"', () => {
			const transport = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			t.expect((transport as any).state).toBe('disconnected');
		});
	});

	t.describe('Connection Management', () => {
		let transport: WebSocketTransport;

		t.beforeEach(() => {
			transport = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
		});

		t.afterEach(async () => {
			// Ensure we disconnect after each test to avoid interference
			await transport.disconnect();
		});

		t.test('should transition through connecting to connected state on connect()', async () => {
			const connectingPromise = waitFor(transport, 'connecting');
			const connectedPromise = waitFor(transport, 'connected');

			const connectPromise = transport.connect();

			// Immediately after calling connect, state should be "connecting"
			t.expect((transport as any).state).toBe('connecting');
			await connectingPromise;

			await connectedPromise;
			t.expect((transport as any).state).toBe('connected');

			await t.expect(connectPromise).resolves.toBeUndefined();
		});

		t.test('should resolve immediately if connect() is called when already connected', async () => {
			await transport.connect();
			t.expect((transport as any).state).toBe('connected');

			// This should resolve without creating a new connection.
			await t.expect(transport.connect()).resolves.toBeUndefined();
		});

		t.test('should resolve if connect() is called while already connecting', async () => {
			const connectPromise1 = transport.connect();
			t.expect((transport as any).state).toBe('connecting');

			const connectPromise2 = transport.connect();

			await t.expect(connectPromise1).resolves.toBeUndefined();
			await t.expect(connectPromise2).resolves.toBeUndefined();
			t.expect((transport as any).state).toBe('connected');
		});

		t.test('should disconnect from a connected state', async () => {
			await transport.connect();
			t.expect((transport as any).state).toBe('connected');

			const disconnectedPromise = waitFor(transport, 'disconnected');
			const disconnectPromise = transport.disconnect();

			await disconnectedPromise;
			t.expect((transport as any).state).toBe('disconnected');
			await t.expect(disconnectPromise).resolves.toBeUndefined();
		});

		t.test('should resolve immediately if disconnect() is called when already disconnected', async () => {
			t.expect((transport as any).state).toBe('disconnected');
			await t.expect(transport.disconnect()).resolves.toBeUndefined();
		});
	});

	t.describe('Subscription Management', () => {
		let transport: WebSocketTransport;
		let channel: string;

		t.beforeEach(async () => {
			// Generate a unique channel for each test
			channel = `session:${crypto.randomUUID()}`;

			transport = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			await transport.connect();
		});

		t.afterEach(async () => {
			await transport.disconnect();
		});

		t.test('should subscribe to a new channel', async () => {
			await t.expect(transport.subscribe(channel)).resolves.toBeUndefined();
		});

		t.test('should resolve immediately if already subscribed to a channel', async () => {
			await transport.subscribe(channel); // First time
			await t.expect(transport.subscribe(channel)).resolves.toBeUndefined(); // Second time
		});

		t.test('should receive a message on a subscribed channel', async () => {
			await transport.subscribe(channel);

			// Use a second transport to publish a message
			const publisher = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			await publisher.connect();

			const payload = `message from publisher ${Date.now()}`;
			const messagePromise = waitFor(transport, 'message');

			// The publisher transport will wrap this payload in an envelope.
			await publisher.publish(channel, payload);

			const received = await messagePromise;

			// The subscriber transport should unwrap the envelope and emit the original payload.
			t.expect(received).toEqual({ channel, data: payload });

			await publisher.disconnect();
		});
	});

	t.describe('Message Publishing and Queuing', () => {
		let publisher: WebSocketTransport;
		let subscriber: WebSocketTransport;
		let channel: string;

		t.beforeEach(async () => {
			// Generate a unique channel for each test
			channel = `session:${crypto.randomUUID()}`;

			publisher = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			subscriber = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });

			// Subscriber must be connected and subscribed to receive messages
			await subscriber.connect();
			await subscriber.subscribe(channel);
		});

		t.afterEach(async () => {
			await publisher.disconnect();
			await subscriber.disconnect();
		});

		t.test('should queue a message when disconnected and send it after connecting', async () => {
			const payload = 'queued-message';
			const messagePromise = waitFor(subscriber, 'message');

			// Publish while disconnected, the promise should be pending
			const publishPromise = publisher.publish(channel, payload);

			// Now connect the publisher
			await publisher.connect();

			// The promise should now resolve, and the message should be received
			await t.expect(publishPromise).resolves.toBeUndefined();
			const received = await messagePromise;
			t.expect(received.data).toBe(payload);
		});

		t.test('should queue a message when connecting and send it after connection is established', async () => {
			const payload = 'queued-while-connecting';
			const messagePromise = waitFor(subscriber, 'message');

			// Start connecting the publisher
			const connectPromise = publisher.connect();
			t.expect((publisher as any).state).toBe('connecting');

			// Publish while the connection is in progress
			const publishPromise = publisher.publish(channel, payload);

			await connectPromise;

			await t.expect(publishPromise).resolves.toBeUndefined();
			const received = await messagePromise;
			t.expect(received.data).toBe(payload);
		});

		t.test('should process multiple queued messages serially in order', async () => {
			const payloads = ['message 1', 'message 2', 'message 3'];
			const receivedMessages: string[] = [];

			const messagesReceivedPromise = new Promise<void>(resolve => {
				const handler = ({ data }: { data: string }) => {
					receivedMessages.push(data);
					if (receivedMessages.length === payloads.length) {
						subscriber.off('message', handler);
						resolve();
					}
				};
				subscriber.on('message', handler);
			});

			// Queue up all messages while disconnected
			const publishPromises = payloads.map(p => publisher.publish(channel, p));

			// Connect to trigger sending the queue
			await publisher.connect();
			await Promise.all(publishPromises); // Wait for all publish promises to resolve

			await messagesReceivedPromise; // Wait for all messages to be received

			t.expect(receivedMessages).toEqual(payloads);
		});

		t.test('should send a message immediately when connected', async () => {
			await publisher.connect();
			const payload = 'instant-message';
			const messagePromise = waitFor(subscriber, 'message');

			await publisher.publish(channel, payload);

			const received = await messagePromise;
			t.expect(received.data).toBe(payload);
		});

		t.test('should reject queued messages on disconnect', async () => {
			const publishPromise = publisher.publish(channel, 'this will be rejected');

			// Disconnecting while a message is in the queue should cause its promise to reject.
			await publisher.disconnect();

			await t.expect(publishPromise).rejects.toThrow('Transport disconnected by client.');
		});
	});

	t.describe('Incoming Message Handling', () => {
		const transports: WebSocketTransport[] = [];
		let subscriber: WebSocketTransport;
		let rawPublisher: WebSocketTransport; // To send specific payloads
		let channel: string;

		t.beforeEach(async () => {
			// Generate a unique channel for each test
			channel = `session:${crypto.randomUUID()}`;

			subscriber = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			rawPublisher = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			transports.push(subscriber, rawPublisher);

			await subscriber.connect();
			await rawPublisher.connect();
			await subscriber.subscribe(channel);
		});

		t.afterEach(async () => {
			await Promise.all(transports.map((t) => t.disconnect()));
			transports.length = 0;
		});

		t.test('should ignore its own published messages', async () => {
			let messageReceived = false;
			subscriber.on('message', () => {
				messageReceived = true;
			});

			// Publish a message on the channel this transport is subscribed to.
			// The transport should ignore this message because it originated from itself.
			await subscriber.publish(channel, 'this-should-be-ignored');

			// Wait a short moment to ensure the message is not processed.
			await new Promise((resolve) => setTimeout(resolve, 200));

			t.expect(messageReceived).toBe(false);
		});

		t.test('should deduplicate messages from other clients', async () => {
			const messagePayload = 'dedup-test-from-other-client';
			const transportMessage = {
				// Use the rawPublisher's ID to simulate a different client
				clientId: (rawPublisher as any).clientId,
				nonce: 456,
				payload: messagePayload,
			};
			const rawMessage = JSON.stringify(transportMessage);

			let messageCount = 0;
			subscriber.on('message', ({ data }) => {
				if (data === messagePayload) {
					messageCount++;
				}
			});

			const firstMessagePromise = waitFor(subscriber, 'message');

			// Publish the raw message for the first time
			await (rawPublisher as any).centrifuge.publish(channel, rawMessage);

			// Wait for it to be received
			await firstMessagePromise;
			t.expect(messageCount).toBe(1);

			// Publish the exact same message again
			await (rawPublisher as any).centrifuge.publish(channel, rawMessage);

			// Wait a short moment to ensure no second message is processed
			await new Promise((resolve) => setTimeout(resolve, 100));

			// The count should still be 1, as the second message was a duplicate
			t.expect(messageCount).toBe(1);
		});

		t.test('should emit an "error" for malformed JSON', async () => {
			const errorPromise = waitFor(subscriber, 'error');

			// Publish a string that is not valid JSON
			await (rawPublisher as any).centrifuge.publish(channel, '{ "bad" "json" }');

			const error = await errorPromise;
			t.expect(error).toBeInstanceOf(Error);
			t.expect(error.message).toContain('Failed to parse incoming message');
		});

		t.test('should emit an "error" for an invalid message structure', async () => {
			const errorPromise = waitFor(subscriber, 'error');

			// Publish valid JSON that does not match the TransportMessage structure
			const invalidMessage = JSON.stringify({ not_a_nonce: 1, not_a_payload: 'hello' });
			await (rawPublisher as any).centrifuge.publish(channel, invalidMessage);

			const error = await errorPromise;
			t.expect(error).toBeInstanceOf(Error);
			t.expect(error.message).toContain('Failed to parse incoming message');
		});
	});

	t.describe('Resilience and Recovery', () => {
		const transports: WebSocketTransport[] = [];

		t.afterEach(async () => {
			// Disconnect all transports created during a test
			await Promise.all(transports.map(transport => transport.disconnect()));
			// Clear transports after each test
			transports.length = 0;
		});

		t.test('should receive historical messages upon subscribing in FIFO order', async () => {
			const channel = `session:${crypto.randomUUID()}`;
			const historicalPublisher = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			transports.push(historicalPublisher);
			await historicalPublisher.connect();

			const payloads = ['history-1', 'history-2', 'history-3'];
			for (const payload of payloads) {
				await historicalPublisher.publish(channel, payload);
			}
			await historicalPublisher.disconnect(); // Disconnect to ensure messages are in history

			// Now, create a new subscriber
			const subscriber = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			transports.push(subscriber);

			const receivedMessages: string[] = [];
			const messagesReceivedPromise = new Promise<void>(resolve => {
				const handler = ({ data }: { data: string }) => {
					receivedMessages.push(data);
					if (receivedMessages.length === payloads.length) {
						subscriber.off('message', handler);
						resolve();
					}
				};
				subscriber.on('message', handler);
			});

			await subscriber.connect();
			await subscriber.subscribe(channel); // This should trigger history fetch

			await messagesReceivedPromise;

			t.expect(receivedMessages).toEqual(payloads);
		});

		t.test('should reject publish promise if publishing fails after all retries', async () => {
			const channel = `session:${crypto.randomUUID()}`;
			const publisher = new WebSocketTransport({ url: WEBSOCKET_URL, websocket: WebSocket });
			transports.push(publisher);
			await publisher.connect();

			const publishSpy = t.vi
				.spyOn((publisher as any).centrifuge, 'publish')
				.mockRejectedValue(new Error('Publication failed'));

			const publishPromise = publisher.publish(channel, 'a-message');

			await t.expect(publishPromise).rejects.toThrow('Publication failed');

			// MAX_RETRY_ATTEMPTS is 5 in websocket.ts
			t.expect(publishSpy).toHaveBeenCalledTimes(5);

			publishSpy.mockRestore();
		});
	});
});
