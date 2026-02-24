import { ClientState, type HandshakeOfferPayload, type Session, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import * as t from "vitest";
import { vi } from "vitest";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";
import { TrustedConnectionHandler } from "./trusted-connection-handler";

function createMockDappHandlerContext(): IConnectionHandlerContext {
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

t.describe("TrustedConnectionHandler", () => {
	let context: IConnectionHandlerContext;
	let handler: TrustedConnectionHandler;
	let mockSession: Session;
	let mockRequest: SessionRequest;
	let mockOffer: HandshakeOfferPayload;

	t.beforeEach(() => {
		context = createMockDappHandlerContext();
		handler = new TrustedConnectionHandler(context);

		mockSession = {
			id: "test-session",
			channel: "",
			keyPair: { publicKey: new Uint8Array(), privateKey: new Uint8Array() },
			theirPublicKey: new Uint8Array(),
			expiresAt: 0,
		};
		mockRequest = {
			id: "test-session",
			channel: "handshake:123",
			expiresAt: Date.now() + 1000,
			mode: "trusted",
			publicKeyB64: "mock-public-key",
		};
		mockOffer = {
			channelId: "secure-channel",
			publicKeyB64: "Aqurq6urq6urq6urq6urq6urq6urq6urq6urq6urq6ur",
		};
	});

	t.test("should execute the full trusted flow successfully", async () => {
		// Mock the handshake offer being received
		context.once = t.vi.fn((event, callback) => {
			if (event === "handshake_offer_received") {
				setTimeout(() => callback(mockOffer), 10);
			}
			return context;
		});

		await handler.execute(mockSession, mockRequest);

		t.expect(context.transport.connect).toHaveBeenCalledOnce();
		t.expect(context.transport.subscribe).toHaveBeenCalledWith(mockRequest.channel);
		t.expect(context.emit).not.toHaveBeenCalledWith("otp_required", t.expect.any(Object));
		t.expect(context.sendMessage).not.toHaveBeenCalledWith(t.expect.stringContaining("session:secure-channel"), { type: "handshake-ack" });
		t.expect(context.sessionstore.set).toHaveBeenCalledOnce();
		t.expect(context.transport.clear).toHaveBeenCalledWith(mockRequest.channel);
		t.expect(context.state).toBe("CONNECTED");
		t.expect(context.emit).toHaveBeenCalledWith("connected");
	});

	t.test("should throw if the handshake offer is not received in time", async () => {
		vi.useFakeTimers();

		// Set expiry time to be far enough in the future to avoid immediate rejection
		mockRequest.expiresAt = Date.now() + 100000; // 100 seconds
		context.once = t.vi.fn(); // Do not resolve the handshake offer

		const executePromise = handler.execute(mockSession, mockRequest);

		// Catch the promise to prevent unhandled rejection
		executePromise.catch(() => {
			// Expected rejection, do nothing
		});

		// Advance timers beyond the HANDSHAKE_TIMEOUT (assuming 60s + 100s buffer)
		await vi.advanceTimersByTimeAsync(170000);

		await t.expect(executePromise).rejects.toThrow(/Did not receive handshake offer/);

		// Clear all timers before restoring real timers
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	t.test("should throw if session request has already expired", async () => {
		mockRequest.expiresAt = Date.now() - 1000; // Expired 1 second ago

		await t.expect(handler.execute(mockSession, mockRequest)).rejects.toThrow("Session request expired before wallet could connect");
	});

	t.test("should properly update session with wallet details", async () => {
		// Mock the handshake offer being received
		context.once = t.vi.fn((event, callback) => {
			if (event === "handshake_offer_received") {
				setTimeout(() => callback(mockOffer), 10);
			}
			return context;
		});
		await handler.execute(mockSession, mockRequest);

		t.expect(context.session).toEqual(
			t.expect.objectContaining({
				id: "test-session",
				channel: "session:secure-channel",
				theirPublicKey: t.expect.any(Uint8Array),
			}),
		);
	});

	t.test("should subscribe to secure session channel", async () => {
		// Mock the handshake offer being received
		context.once = t.vi.fn((event, callback) => {
			if (event === "handshake_offer_received") {
				setTimeout(() => callback(mockOffer), 10);
			}
			return context;
		});
		const transportSubscribeSpy = t.vi.spyOn(context.transport, "subscribe");

		await handler.execute(mockSession, mockRequest);

		// Should subscribe to handshake channel first, then session channel
		t.expect(transportSubscribeSpy).toHaveBeenNthCalledWith(1, mockRequest.channel);
		t.expect(transportSubscribeSpy).toHaveBeenNthCalledWith(2, "session:secure-channel");
	});
});
