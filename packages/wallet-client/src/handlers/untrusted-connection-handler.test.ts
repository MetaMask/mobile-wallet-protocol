/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import { ClientState, type Session, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import * as t from "vitest";
import { vi } from "vitest";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";
import { UntrustedConnectionHandler } from "./untrusted-connection-handler";

function createMockWalletHandlerContext(): IConnectionHandlerContext {
	return {
		session: null,
		state: ClientState.DISCONNECTED,
		transport: {
			connect: vi.fn(),
			disconnect: vi.fn(),
			publish: vi.fn(),
			subscribe: vi.fn(),
			on: vi.fn(),
			clear: vi.fn(),
		},
		sessionstore: {
			set: vi.fn(),
			get: vi.fn(),
			list: vi.fn(),
			delete: vi.fn(),
		},
		emit: vi.fn(),
		once: vi.fn(),
		off: vi.fn(),
		sendMessage: vi.fn(),
	};
}

t.describe("UntrustedConnectionHandler", () => {
	let context: IConnectionHandlerContext;
	let handler: UntrustedConnectionHandler;
	let mockSession: Session;
	let mockRequest: SessionRequest;

	t.beforeEach(() => {
		context = createMockWalletHandlerContext();
		handler = new UntrustedConnectionHandler(context);

		mockSession = {
			id: "test-session",
			channel: "session:secure-channel",
			keyPair: { publicKey: new Uint8Array([1, 2, 3]), privateKey: new Uint8Array() },
			theirPublicKey: new Uint8Array(),
			expiresAt: 0,
		};
		mockRequest = {
			id: "test-session",
			channel: "handshake:123",
			mode: "untrusted",
			expiresAt: Date.now() + 1000,
			publicKeyB64: "mock-public-key",
		};

		context.once = t.vi.fn((event, callback) => {
			if (event === "handshake_ack_received") {
				setTimeout(() => callback(), 10);
			}
			return context;
		});
	});

	t.test("should execute the full untrusted flow successfully", async () => {
		await handler.execute(mockSession, mockRequest);

		t.expect(context.transport.connect).toHaveBeenCalledOnce();
		t.expect(context.transport.subscribe).toHaveBeenCalledWith(mockRequest.channel);
		t.expect(context.transport.subscribe).toHaveBeenCalledWith(mockSession.channel);
		t.expect(context.emit).toHaveBeenCalledWith("display_otp", t.expect.any(String), t.expect.any(Number));
		t.expect(context.sendMessage).toHaveBeenCalledWith(mockRequest.channel, t.expect.objectContaining({ type: "handshake-offer" }));

		// Verify that the handshake offer contains an OTP
		const sendMessageMock = context.sendMessage as t.MockedFunction<typeof context.sendMessage>;
		const sendMessageCall = sendMessageMock.mock.calls[0];
		const message = sendMessageCall[1] as { type: string; payload: { otp: string; deadline: number } };
		const payload = message.payload;
		t.expect(payload.otp).toBeDefined();
		t.expect(payload.otp).toMatch(/^\d{6}$/); // 6-digit OTP
		t.expect(payload.deadline).toBeTypeOf("number");

		t.expect(context.sessionstore.set).toHaveBeenCalledOnce();
		t.expect(context.transport.clear).toHaveBeenCalledWith(mockRequest.channel);
		t.expect(context.state).toBe("CONNECTED");
		t.expect(context.emit).toHaveBeenCalledWith("connected");
	});

	t.test("should generate a 6-digit OTP", async () => {
		await handler.execute(mockSession, mockRequest);

		const emitMock = context.emit as any;
		const emitCall = emitMock.mock.calls.find((call: any[]) => call[0] === "display_otp");
		t.expect(emitCall).toBeDefined();
		if (emitCall) {
			t.expect(emitCall[1]).toMatch(/^\d{6}$/); // Should be exactly 6 digits
		}
	});

	t.test("should set OTP deadline correctly", async () => {
		const beforeExecution = Date.now();
		await handler.execute(mockSession, mockRequest);
		const afterExecution = Date.now();

		const emitMock = context.emit as any;
		const emitCall = emitMock.mock.calls.find((call: any[]) => call[0] === "display_otp");
		t.expect(emitCall).toBeDefined();
		const deadline = emitCall?.[2] as number;

		// Deadline should be approximately 1 minute from now (60000ms)
		const expectedDeadline = beforeExecution + 60000;
		t.expect(deadline).toBeGreaterThanOrEqual(expectedDeadline);
		t.expect(deadline).toBeLessThanOrEqual(afterExecution + 60000);
	});

	t.test(
		"should throw if handshake acknowledgment times out",
		async () => {
			// Mock a deadline that's already passed by creating a context that doesn't trigger the ack
			context.once = t.vi.fn(); // Don't resolve the acknowledgment

			// Mock the OTP generation to return a very short deadline
			const originalDateNow = Date.now;
			let callCount = 0;
			Date.now = t.vi.fn(() => {
				callCount++;
				if (callCount === 1) {
					// First call during deadline generation
					return originalDateNow();
				} else {
					// Subsequent calls during timeout check - make it seem like time has passed
					return originalDateNow() + 70000; // 70 seconds passed
				}
			});

			try {
				await t.expect(handler.execute(mockSession, mockRequest)).rejects.toThrow("Handshake timed out before it could begin");
			} finally {
				Date.now = originalDateNow;
			}
		},
		10000,
	);

	t.test("should include correct handshake offer payload", async () => {
		await handler.execute(mockSession, mockRequest);

		const sendMessageMock = context.sendMessage as t.MockedFunction<typeof context.sendMessage>;
		const sendMessageCall = sendMessageMock.mock.calls[0];
		const message = sendMessageCall[1] as { type: string; payload: { publicKeyB64: string; channelId: string; otp: string; deadline: number } };
		const payload = message.payload;

		t.expect(payload).toEqual(
			t.expect.objectContaining({
				publicKeyB64: t.expect.any(String),
				channelId: "secure-channel", // Should extract channel ID without "session:" prefix
				otp: t.expect.stringMatching(/^\d{6}$/),
				deadline: t.expect.any(Number),
			}),
		);
	});

	t.test("should wait for handshake acknowledgment", async () => {
		await handler.execute(mockSession, mockRequest);

		// Verify that the handler was waiting for the acknowledgment
		t.expect(context.once).toHaveBeenCalledWith("handshake_ack_received", t.expect.any(Function));
	});
});
