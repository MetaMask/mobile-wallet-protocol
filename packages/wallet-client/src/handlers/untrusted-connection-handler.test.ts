/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import { ClientState, type Message, type Session, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
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
		handleMessage: vi.fn(),
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

	t.test("should process a valid initialMessage after finalizing connection", async () => {
		const initialMessage: Message = { type: "message", payload: { method: "eth_requestAccounts" } };
		mockRequest.initialMessage = initialMessage;
		const handleMessageSpy = vi.spyOn(context, "handleMessage");

		await handler.execute(mockSession, mockRequest);

		// Verify 'connected' was emitted
		t.expect(context.emit).toHaveBeenCalledWith("connected");

		// Initially, handleMessage should not have been called yet (it's in setTimeout)
		t.expect(handleMessageSpy).not.toHaveBeenCalled();

		// Wait for the next tick to allow setTimeout to execute
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Now handleMessage should have been called
		t.expect(handleMessageSpy).toHaveBeenCalledWith(initialMessage);

		// Verify that 'connected' is emitted before 'handleMessage' is called.
		const connectedCallOrder = (context.emit as t.Mock).mock.invocationCallOrder.find((_order, i) => {
			return (context.emit as t.Mock).mock.calls[i][0] === "connected";
		});
		const handleMessageCallOrder = handleMessageSpy.mock.invocationCallOrder[0];

		t.expect(connectedCallOrder).toBeLessThan(handleMessageCallOrder);
	});

	t.describe("otp-display-grant", () => {
		function setupDeferredGrantMocks(): { resolveGrant: () => void; resolveAck: () => void } {
			let resolveGrant: () => void = () => {};
			let resolveAck: () => void = () => {};

			context.once = t.vi.fn((event, callback) => {
				if (event === "otp_display_grant_received") {
					resolveGrant = callback;
				} else if (event === "handshake_ack_received") {
					resolveAck = callback;
				}
				return context;
			});

			return { resolveGrant: () => resolveGrant(), resolveAck: () => resolveAck() };
		}

		t.test("should defer display_otp until otp-display-grant when capability is advertised", async () => {
			mockRequest.capabilities = { otpDisplayGrant: true };
			const { resolveGrant, resolveAck } = setupDeferredGrantMocks();

			const executePromise = handler.execute(mockSession, mockRequest);

			await t.vi.waitFor(() => {
				t.expect(context.sendMessage).toHaveBeenCalledWith(mockRequest.channel, t.expect.objectContaining({ type: "handshake-offer" }));
			});

			const onceMock = context.once as t.Mock;
			const grantListenerCallIndex = onceMock.mock.calls.findIndex((call) => call[0] === "otp_display_grant_received");
			const grantListenerInvocation = onceMock.mock.invocationCallOrder[grantListenerCallIndex];
			const sendOfferInvocation = (context.sendMessage as t.Mock).mock.invocationCallOrder[0];
			t.expect(grantListenerInvocation).toBeLessThan(sendOfferInvocation);

			const sendMessageMock = context.sendMessage as t.MockedFunction<typeof context.sendMessage>;
			const message = sendMessageMock.mock.calls[0][1] as { payload: { otpDisplayGrantRequired?: boolean } };
			t.expect(message.payload.otpDisplayGrantRequired).toBe(true);

			const emitMock = context.emit as t.Mock;
			t.expect(emitMock.mock.calls.some((call) => call[0] === "display_otp")).toBe(false);

			resolveGrant();
			await t.vi.waitFor(() => {
				t.expect(context.emit).toHaveBeenCalledWith("display_otp", t.expect.any(String), t.expect.any(Number));
			});

			resolveAck();
			await executePromise;
		});

		t.test("should throw if otp-display-grant is not received in time", async () => {
			mockRequest.capabilities = { otpDisplayGrant: true };
			context.once = t.vi.fn();

			const originalDateNow = Date.now;
			let callCount = 0;
			Date.now = t.vi.fn(() => {
				callCount++;
				if (callCount === 1) {
					return originalDateNow();
				}
				return originalDateNow() + 70000;
			});

			try {
				await t.expect(handler.execute(mockSession, mockRequest)).rejects.toThrow("OTP display grant timed out before it could begin.");
			} finally {
				Date.now = originalDateNow;
			}
		});

		t.test("should keep legacy flow when capability is not advertised", async () => {
			const emitMock = context.emit as t.Mock;
			const sendMessageMock = context.sendMessage as t.Mock;

			await handler.execute(mockSession, mockRequest);

			const displayOtpInvocation = emitMock.mock.invocationCallOrder.find((_, index) => emitMock.mock.calls[index][0] === "display_otp");
			const sendOfferInvocation = sendMessageMock.mock.invocationCallOrder[0];

			t.expect(displayOtpInvocation).toBeDefined();
			t.expect(sendOfferInvocation).toBeDefined();
			t.expect(displayOtpInvocation).toBeLessThan(sendOfferInvocation);

			const message = sendMessageMock.mock.calls[0][1] as { payload: { otpDisplayGrantRequired?: boolean } };
			t.expect(message.payload.otpDisplayGrantRequired).toBeUndefined();
		});

		t.test("should complete strict flow successfully", async () => {
			mockRequest.capabilities = { otpDisplayGrant: true };
			const { resolveGrant, resolveAck } = setupDeferredGrantMocks();

			const executePromise = handler.execute(mockSession, mockRequest);

			await t.vi.waitFor(() => {
				t.expect(context.sendMessage).toHaveBeenCalledWith(
					mockRequest.channel,
					t.expect.objectContaining({
						type: "handshake-offer",
						payload: t.expect.objectContaining({ otpDisplayGrantRequired: true }),
					}),
				);
			});

			const emitMock = context.emit as t.Mock;
			t.expect(emitMock.mock.calls.some((call) => call[0] === "display_otp")).toBe(false);

			resolveGrant();
			await t.vi.waitFor(() => {
				t.expect(context.emit).toHaveBeenCalledWith("display_otp", t.expect.any(String), t.expect.any(Number));
			});

			const displayOtpInvocation = emitMock.mock.invocationCallOrder.find((_, index) => emitMock.mock.calls[index][0] === "display_otp");
			const sendOfferInvocation = (context.sendMessage as t.Mock).mock.invocationCallOrder[0];
			t.expect(displayOtpInvocation).toBeDefined();
			t.expect(displayOtpInvocation).toBeGreaterThan(sendOfferInvocation);

			resolveAck();
			await executePromise;

			t.expect(context.transport.connect).toHaveBeenCalledOnce();
			t.expect(context.transport.subscribe).toHaveBeenCalledWith(mockRequest.channel);
			t.expect(context.transport.subscribe).toHaveBeenCalledWith(mockSession.channel);
			t.expect(context.sessionstore.set).toHaveBeenCalledOnce();
			t.expect(context.transport.clear).toHaveBeenCalledWith(mockRequest.channel);
			t.expect(context.state).toBe("CONNECTED");
			t.expect(context.emit).toHaveBeenCalledWith("connected");
		});
	});
});
