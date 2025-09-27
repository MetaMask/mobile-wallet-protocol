import { ClientState, type Message, type Session, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import * as t from "vitest";
import { vi } from "vitest";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";
import { TrustedConnectionHandler } from "./trusted-connection-handler";

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

t.describe("TrustedConnectionHandler", () => {
	let context: IConnectionHandlerContext;
	let handler: TrustedConnectionHandler;
	let mockSession: Session;
	let mockRequest: SessionRequest;

	t.beforeEach(() => {
		context = createMockWalletHandlerContext();
		handler = new TrustedConnectionHandler(context);

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
			mode: "trusted",
			expiresAt: Date.now() + 1000,
			publicKeyB64: "mock-public-key",
		};
	});

	t.test("should execute the full trusted flow without emitting an OTP", async () => {
		await handler.execute(mockSession, mockRequest);

		t.expect(context.transport.connect).toHaveBeenCalledOnce();
		t.expect(context.transport.subscribe).toHaveBeenCalledWith(mockRequest.channel);
		t.expect(context.transport.subscribe).toHaveBeenCalledWith(mockSession.channel);
		t.expect(context.emit).not.toHaveBeenCalledWith("display_otp", t.expect.any(String), t.expect.any(Number));
		t.expect(context.sendMessage).toHaveBeenCalledWith(mockRequest.channel, t.expect.objectContaining({ type: "handshake-offer" }));

		// Verify that the handshake offer does NOT contain an OTP
		const sendMessageMock = context.sendMessage as t.MockedFunction<typeof context.sendMessage>;
		const sendMessageCall = sendMessageMock.mock.calls[0];
		const message = sendMessageCall[1] as { type: string; payload: { publicKeyB64: string; channelId: string } };
		const payload = message.payload;
		t.expect((payload as { otp?: string }).otp).toBeUndefined();

		t.expect(context.sessionstore.set).toHaveBeenCalledOnce();
		t.expect(context.transport.clear).toHaveBeenCalledWith(mockRequest.channel);
		t.expect(context.state).toBe("CONNECTED");
		t.expect(context.emit).toHaveBeenCalledWith("connected");
	});

	t.test("should include correct handshake offer payload without OTP", async () => {
		await handler.execute(mockSession, mockRequest);

		const sendMessageMock = context.sendMessage as t.MockedFunction<typeof context.sendMessage>;
		const sendMessageCall = sendMessageMock.mock.calls[0];
		const message = sendMessageCall[1] as { type: string; payload: { publicKeyB64: string; channelId: string } };
		const payload = message.payload;

		t.expect(payload).toEqual({
			publicKeyB64: t.expect.any(String),
			channelId: "secure-channel", // Should extract channel ID without "session:" prefix
		});

		// Explicitly verify no OTP-related fields
		t.expect((payload as { otp?: string }).otp).toBeUndefined();
		t.expect((payload as { deadline?: number }).deadline).toBeUndefined();
	});

	t.test("should subscribe to both handshake and session channels", async () => {
		const transportSubscribeSpy = t.vi.spyOn(context.transport, "subscribe");

		await handler.execute(mockSession, mockRequest);

		t.expect(transportSubscribeSpy).toHaveBeenCalledWith(mockRequest.channel); // handshake channel
		t.expect(transportSubscribeSpy).toHaveBeenCalledWith(mockSession.channel); // session channel
		t.expect(transportSubscribeSpy).toHaveBeenCalledTimes(2);
	});

	t.test("should set session in context before sending offer", async () => {
		await handler.execute(mockSession, mockRequest);

		t.expect(context.session).toBe(mockSession);
	});

	t.test("should send handshake offer", async () => {
		const sendMessageSpy = t.vi.spyOn(context, "sendMessage");

		await handler.execute(mockSession, mockRequest);

		t.expect(sendMessageSpy).toHaveBeenCalledOnce();
		t.expect(sendMessageSpy).toHaveBeenCalledWith(mockRequest.channel, t.expect.objectContaining({ type: "handshake-offer" }));
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
});
