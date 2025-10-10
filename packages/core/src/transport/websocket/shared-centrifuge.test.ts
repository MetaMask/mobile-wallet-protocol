/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import * as t from "vitest";
import { SharedCentrifuge } from "./shared-centrifuge";

t.describe("SharedCentrifuge Unit Tests", () => {
	t.afterEach(async () => {
		// Clean up any shared contexts after each test
		// @ts-expect-error - accessing private property for cleanup
		const contexts = SharedCentrifuge.contexts;
		for (const [url, context] of contexts.entries()) {
			// Clear any pending reconnect promises
			context.reconnectPromise = null;
			// Remove all event listeners to prevent unhandled errors
			const centrifuge = context.centrifuge as any;
			if (centrifuge.off) {
				centrifuge.off("connected");
				centrifuge.off("disconnected");
				centrifuge.off("error");
			}
		}
		contexts.clear();

		// Wait a bit for any pending timers to complete
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

	t.describe("reconnect() idempotency", () => {
		t.test("should return the same promise for multiple simultaneous reconnect calls", async () => {
			const url = "ws://test-url.com";
			const client1 = new SharedCentrifuge(url, { websocket: t.vi.fn() as any });
			const client2 = new SharedCentrifuge(url, { websocket: t.vi.fn() as any });
			const client3 = new SharedCentrifuge(url, { websocket: t.vi.fn() as any });

			// Access the shared context
			// @ts-expect-error - accessing private property for test
			const context = SharedCentrifuge.contexts.get(url);
			t.expect(context).toBeDefined();
			if (!context) throw new Error("Context should be defined");

			// Mock the underlying centrifuge methods
			const mockCentrifuge = context.centrifuge as any;
			mockCentrifuge.state = "connected";
			mockCentrifuge.disconnect = t.vi.fn();
			mockCentrifuge.connect = t.vi.fn();
			const eventCallbacks = new Map<string, (ctx?: any) => void>();
			mockCentrifuge.once = t.vi.fn((event: string, callback: (ctx?: any) => void) => {
				eventCallbacks.set(event, callback);
				// Simulate async disconnected/connected events only
				if (event === "disconnected") {
					setTimeout(() => callback(), 10);
				} else if (event === "connected") {
					setTimeout(() => callback(), 10);
				}
				// Error event is registered but never triggered
			});
			mockCentrifuge.off = t.vi.fn();

			// Call reconnect on all three clients simultaneously
			const promise1 = client1.reconnect();
			const promise2 = client2.reconnect();
			const promise3 = client3.reconnect();

			// All three should return the SAME promise object (idempotent behavior)
			t.expect(promise1).toBe(promise2);
			t.expect(promise2).toBe(promise3);

			// Wait for all to complete
			await Promise.all([promise1, promise2, promise3]);

			// Verify disconnect and connect were only called ONCE, not three times
			t.expect(mockCentrifuge.disconnect).toHaveBeenCalledTimes(1);
			t.expect(mockCentrifuge.connect).toHaveBeenCalledTimes(1);
		});

		t.test("should allow new reconnect after previous one completes", async () => {
			const url = "ws://test-url.com";
			const client = new SharedCentrifuge(url, { websocket: t.vi.fn() as any });

			// @ts-expect-error - accessing private property for test
			const context = SharedCentrifuge.contexts.get(url);
			if (!context) throw new Error("Context should be defined");
			const mockCentrifuge = context.centrifuge as any;
			mockCentrifuge.state = "connected";
			mockCentrifuge.disconnect = t.vi.fn();
			mockCentrifuge.connect = t.vi.fn();
			mockCentrifuge.once = t.vi.fn((event: string, callback: (ctx?: any) => void) => {
				// Only trigger disconnected/connected events, not error
				if (event === "disconnected" || event === "connected") {
					setTimeout(() => callback(), 10);
				}
			});
			mockCentrifuge.off = t.vi.fn();

			// First reconnect
			const promise1 = client.reconnect();
			await promise1;

			// Reset mock call counts
			mockCentrifuge.disconnect.mockClear();
			mockCentrifuge.connect.mockClear();

			// Second reconnect should create a NEW promise
			const promise2 = client.reconnect();
			t.expect(promise1).not.toBe(promise2);

			await promise2;

			// Should have called disconnect and connect again
			t.expect(mockCentrifuge.disconnect).toHaveBeenCalledTimes(1);
			t.expect(mockCentrifuge.connect).toHaveBeenCalledTimes(1);
		});

		t.test("should handle reconnect calls while another reconnect is in progress", async () => {
			const url = "ws://test-url.com";
			const client = new SharedCentrifuge(url, { websocket: t.vi.fn() as any });

			// @ts-expect-error - accessing private property for test
			const context = SharedCentrifuge.contexts.get(url);
			if (!context) throw new Error("Context should be defined");
			const mockCentrifuge = context.centrifuge as any;
			mockCentrifuge.state = "connected";
			mockCentrifuge.disconnect = t.vi.fn();
			mockCentrifuge.connect = t.vi.fn();

			let disconnectCallback: (() => void) | null = null;
			let connectCallback: (() => void) | null = null;

			mockCentrifuge.once = t.vi.fn((event: string, callback: () => void) => {
				if (event === "disconnected") {
					disconnectCallback = callback;
				} else if (event === "connected") {
					connectCallback = callback;
				}
				// Error event is registered but never triggered
			});
			mockCentrifuge.off = t.vi.fn();

			// Start first reconnect (don't await yet)
			const promise1 = client.reconnect();

			// While reconnect is in progress, call it again from multiple clients
			const promise2 = client.reconnect();
			const client2 = new SharedCentrifuge(url, { websocket: t.vi.fn() as any });
			const promise3 = client2.reconnect();

			// All should be the same promise
			t.expect(promise1).toBe(promise2);
			t.expect(promise2).toBe(promise3);

			// Now simulate the disconnected event
			t.expect(disconnectCallback).not.toBeNull();
			if (disconnectCallback) disconnectCallback();

			// Wait a tick for the promise to progress
			await new Promise((resolve) => setTimeout(resolve, 20));

			// Now simulate the connected event
			t.expect(connectCallback).not.toBeNull();
			if (connectCallback) connectCallback();

			// All promises should resolve
			await Promise.all([promise1, promise2, promise3]);

			// Should only have called disconnect and connect once
			t.expect(mockCentrifuge.disconnect).toHaveBeenCalledTimes(1);
			t.expect(mockCentrifuge.connect).toHaveBeenCalledTimes(1);
		});

		t.test("should handle reconnect with no context gracefully", async () => {
			const url = "ws://test-url.com";
			const client = new SharedCentrifuge(url, { websocket: t.vi.fn() as any });

			// Manually delete the context (simulating an edge case)
			// @ts-expect-error - accessing private property for test
			SharedCentrifuge.contexts.delete(url);

			// Should resolve without error
			await t.expect(client.reconnect()).resolves.toBeUndefined();
		});

		t.test("should handle multiple rapid reconnect cycles", async () => {
			const url = "ws://test-url.com";
			const clients = [
				new SharedCentrifuge(url, { websocket: t.vi.fn() as any }),
				new SharedCentrifuge(url, { websocket: t.vi.fn() as any }),
				new SharedCentrifuge(url, { websocket: t.vi.fn() as any }),
			];

			// @ts-expect-error - accessing private property for test
			const context = SharedCentrifuge.contexts.get(url);
			if (!context) throw new Error("Context should be defined");
			const mockCentrifuge = context.centrifuge as any;
			mockCentrifuge.state = "connected";
			mockCentrifuge.disconnect = t.vi.fn();
			mockCentrifuge.connect = t.vi.fn();
			mockCentrifuge.once = t.vi.fn((event: string, callback: (ctx?: any) => void) => {
				// Only trigger disconnected/connected events, not error
				if (event === "disconnected" || event === "connected") {
					setTimeout(() => callback(), 5);
				}
			});
			mockCentrifuge.off = t.vi.fn();

			// Simulate 5 reconnect cycles
			for (let cycle = 0; cycle < 5; cycle++) {
				const promises = clients.map((client) => client.reconnect());
				await Promise.all(promises);

				// After each cycle, verify disconnect and connect were called exactly once more
				t.expect(mockCentrifuge.disconnect).toHaveBeenCalledTimes(cycle + 1);
				t.expect(mockCentrifuge.connect).toHaveBeenCalledTimes(cycle + 1);
			}
		});
	});
});
