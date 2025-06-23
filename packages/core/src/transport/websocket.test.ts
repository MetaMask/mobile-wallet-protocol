import { v4 as uuid } from "uuid";
import * as t from "vitest";
import WebSocket from "ws";
import { WebSocketTransport } from "./websocket";

const RELAY_SERVER_URL = "ws://localhost:8000/connection/websocket";

t.describe("WebSocketTransport - Integration Tests", () => {
	let transport1: WebSocketTransport;
	let transport2: WebSocketTransport;

	t.beforeEach(() => {
		transport1 = new WebSocketTransport({ url: RELAY_SERVER_URL, websocket: WebSocket });
		transport2 = new WebSocketTransport({ url: RELAY_SERVER_URL, websocket: WebSocket });
	});

	t.afterEach(async () => {
		await Promise.all([transport1.disconnect(), transport2.disconnect()]);
		await new Promise((resolve) => setTimeout(resolve, 100));
	});

	t.test("should connect and disconnect", async () => {
		const onConnected = new Promise<void>((resolve) => transport1.once("connected", resolve));
		await transport1.connect();
		await t.expect(onConnected).resolves.toBeUndefined();

		const onDisconnected = new Promise<void>((resolve) => transport1.once("disconnected", resolve));
		await transport1.disconnect();
		await t.expect(onDisconnected).resolves.toBeUndefined();
	});

	t.test("should subscribe to a channel", async () => {
		const channel = `session:${uuid()}`;
		await transport1.connect();
		await t.expect(transport1.subscribe(channel)).resolves.toBeUndefined();
	});

	t.test("should publish a message and be received by a subscriber", async () => {
		const channel = `session:${uuid()}`;
		const message = "hello from transport2";

		await Promise.all([transport1.connect(), transport2.connect()]);

		const messageReceived = new Promise<{ channel: string; data: string }>((resolve) => {
			transport1.on("message", resolve);
		});

		await transport1.subscribe(channel);
		// Add a small delay to ensure subscription is active before publishing
		await new Promise((resolve) => setTimeout(resolve, 200));
		await transport2.publish(channel, message);

		const received = await messageReceived;

		t.expect(received.channel).toBe(channel);
		t.expect(received.data).toBe(message);
	});

	t.test("should handle multiple subscribers", async () => {
		const channel = `session:${uuid()}`;
		const message = "hello to all subscribers";

		const transport3 = new WebSocketTransport({ url: RELAY_SERVER_URL, websocket: WebSocket });
		await Promise.all([transport1.connect(), transport2.connect(), transport3.connect()]);

		const message1Promise = new Promise((resolve) => transport1.once("message", resolve));
		const message2Promise = new Promise((resolve) => transport2.once("message", resolve));

		await Promise.all([transport1.subscribe(channel), transport2.subscribe(channel)]);
		// Add a small delay to ensure subscriptions are active
		await new Promise((resolve) => setTimeout(resolve, 200));
		await transport3.publish(channel, message);

		const [msg1, msg2] = await Promise.all([message1Promise, message2Promise]);

		t.expect(msg1).toEqual({ channel, data: message });
		t.expect(msg2).toEqual({ channel, data: message });

		await transport3.disconnect();
	});

	t.test("should not receive messages on a channel it is not subscribed to", async () => {
		const channel1 = `session:${uuid()}`;
		const channel2 = `session:${uuid()}`;
		const message = "you should not see this";
		let received = false;

		await Promise.all([transport1.connect(), transport2.connect()]);

		transport1.on("message", (msg) => {
			if (msg.channel === channel2) {
				received = true;
			}
		});

		await transport1.subscribe(channel1);
		await transport2.publish(channel2, message);

		// Wait a bit to see if a message arrives
		await new Promise((resolve) => setTimeout(resolve, 500));

		t.expect(received).toBe(false);
	});
}); 