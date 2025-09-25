// Path: packages/core/src/transport/websocket/shared-centrifuge.integration.test.ts
import { v4 as uuid } from "uuid";
import * as t from "vitest";
import WebSocket from "ws";
import { SharedCentrifuge } from "./shared-centrifuge";

const WEBSOCKET_URL = "ws://localhost:8000/connection/websocket";

// Helper to wait for a specific event
const waitFor = (emitter: SharedCentrifuge, event: string): Promise<unknown> => {
	return new Promise((resolve) => emitter.once(event, resolve));
};

t.describe("SharedCentrifuge Integration Tests", () => {
	const instances: SharedCentrifuge[] = [];

	t.afterEach(async () => {
		// Ensure all created instances are disconnected and cleaned up
		await Promise.all(instances.map((instance) => instance.disconnect()));
		instances.length = 0; // Clear the array
	});

	t.test("should connect a single instance and reflect correct state changes", async () => {
		const client = new SharedCentrifuge(WEBSOCKET_URL, { websocket: WebSocket });
		instances.push(client);

		t.expect(client.state).toBe("disconnected");

		// Set up listener before connecting
		const connectedPromise = waitFor(client, "connected");
		client.connect();

		t.expect(["connecting", "connected"]).toContain(client.state);
		await connectedPromise;
		t.expect(client.state).toBe("connected");

		const disconnectedPromise = waitFor(client, "disconnected");
		client.disconnect(); // Don't await here to avoid race condition
		await disconnectedPromise;

		t.expect(client.state).toBe("disconnected");
	});

	t.test("should share a single connection between two instances", async () => {
		const clientA = new SharedCentrifuge(WEBSOCKET_URL, { websocket: WebSocket });
		instances.push(clientA);
		const clientB = new SharedCentrifuge(WEBSOCKET_URL, { websocket: WebSocket });
		instances.push(clientB);

		// Both clients should share the same underlying 'real' client
		// @ts-expect-error - accessing private property for test
		t.expect(clientA.real).toBe(clientB.real);

		// Set up listeners before connecting
		const connectedPromiseA = waitFor(clientA, "connected");
		const connectedPromiseB = waitFor(clientB, "connected");

		clientA.connect();
		await connectedPromiseA;
		await connectedPromiseB; // Should resolve quickly as connection is shared

		t.expect(clientA.state).toBe("connected");
		t.expect(clientB.state).toBe("connected");

		// Disconnect A, B should remain connected
		await clientA.disconnect();
		t.expect(clientA.state).toBe("disconnected");
		t.expect(clientB.state).toBe("connected");
		// @ts-expect-error - accessing private property for test
		t.expect(clientB.real.state).toBe("connected");

		// Disconnect B, the real connection should now close
		const realDisconnectPromise = waitFor(clientB, "disconnected");
		await clientB.disconnect();
		await realDisconnectPromise;

		t.expect(clientB.state).toBe("disconnected");
	});

	t.test("should subscribe to a channel and receive a message", async () => {
		const channel = `session:${uuid()}`;
		const client = new SharedCentrifuge(WEBSOCKET_URL, { websocket: WebSocket });
		instances.push(client);

		// Set up listener before connecting
		const connectedPromise = waitFor(client, "connected");
		client.connect();
		await connectedPromise;

		const sub = client.newSubscription(channel);
		const messagePromise = new Promise((resolve) => {
			sub.on("publication", (ctx) => resolve(ctx.data));
		});

		sub.subscribe();
		await new Promise((resolve) => sub.once("subscribed", resolve));

		const payload = { message: "hello world" };
		await client.publish(channel, JSON.stringify(payload));

		const received = await messagePromise;
		t.expect(JSON.parse(received as string)).toEqual(payload);
	});

	t.test("should maintain a subscription as long as one client is subscribed", async () => {
		const channel = `session:${uuid()}`;
		const clientA = new SharedCentrifuge(WEBSOCKET_URL, { websocket: WebSocket });
		instances.push(clientA);
		const clientB = new SharedCentrifuge(WEBSOCKET_URL, { websocket: WebSocket });
		instances.push(clientB);

		// Set up listeners before connecting
		const connectedPromiseA = waitFor(clientA, "connected");
		const connectedPromiseB = waitFor(clientB, "connected");

		clientA.connect();
		await connectedPromiseA;
		await connectedPromiseB;

		const subA = clientA.newSubscription(channel);
		const subB = clientB.newSubscription(channel);
		subA.subscribe();
		subB.subscribe();

		await new Promise((resolve) => subB.once("subscribed", resolve));
		// @ts-expect-error - accessing private property for test
		t.expect(clientA.real.getSubscription(channel)).not.toBeNull();

		// Client A removes its subscription, but the real one should remain for B
		clientA.removeSubscription(subA);
		// @ts-expect-error - accessing private property for test
		t.expect(clientA.real.getSubscription(channel)).not.toBeNull();

		// Client B removes its subscription, which should now remove the real one
		clientB.removeSubscription(subB);
		// Wait a moment for the async removal to process
		await new Promise((resolve) => setTimeout(resolve, 50));
		// @ts-expect-error - accessing private property for test
		t.expect(clientA.real.getSubscription(channel)).toBeNull();
	});

	t.test("reconnect() should force a physical reconnection for all shared instances", async () => {
		const clientA = new SharedCentrifuge(WEBSOCKET_URL, { websocket: WebSocket });
		instances.push(clientA);

		const clientB = new SharedCentrifuge(WEBSOCKET_URL, { websocket: WebSocket });
		instances.push(clientB);

		// Set up listeners before connecting
		const connectedPromiseA = waitFor(clientA, "connected");
		const connectedPromiseB = waitFor(clientB, "connected");

		clientA.connect();
		await connectedPromiseA;
		await connectedPromiseB;

		// Set up listeners for disconnect/reconnect cycle
		const disconnectPromiseA = waitFor(clientA, "disconnected");
		const disconnectPromiseB = waitFor(clientB, "disconnected");
		const reconnectPromiseA = waitFor(clientA, "connected");
		const reconnectPromiseB = waitFor(clientB, "connected");

		// Trigger reconnect on client A
		clientA.reconnect();

		// Both clients should observe the full disconnect/reconnect cycle
		await Promise.all([disconnectPromiseA, disconnectPromiseB]);
		t.expect(["connecting", "disconnected"]).toContain(clientA.state);
		t.expect(["connecting", "disconnected"]).toContain(clientB.state);

		await Promise.all([reconnectPromiseA, reconnectPromiseB]);
		t.expect(clientA.state).toBe("connected");
		t.expect(clientB.state).toBe("connected");
	});
});
