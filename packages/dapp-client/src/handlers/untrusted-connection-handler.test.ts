/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import { ClientState, type HandshakeOfferPayload, type Session, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import * as t from "vitest";
import { vi } from "vitest";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";
import { UntrustedConnectionHandler } from "./untrusted-connection-handler";

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

t.describe("UntrustedConnectionHandler", () => {
	let context: IConnectionHandlerContext;
	let handler: UntrustedConnectionHandler;
	let mockSession: Session;
	let mockRequest: SessionRequest;
	let mockOffer: HandshakeOfferPayload;

	t.beforeEach(() => {
		context = createMockDappHandlerContext();
		handler = new UntrustedConnectionHandler(context);

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
			mode: "untrusted",
			publicKeyB64: "mock-public-key",
		};
		mockOffer = {
			channelId: "secure-channel",
			publicKeyB64: "cHVia2V5",
			otp: "123456",
			deadline: Date.now() + 1000,
		};

		// Mock the event listener for handshake offer
		context.once = t.vi.fn((event, callback) => {
			if (event === "handshake_offer_received") {
				setTimeout(() => callback(mockOffer), 10); // Simulate async event
			}
			return context;
		});
	});

	t.test("should execute the full untrusted flow successfully", async () => {
		// Mock the OTP input part of the flow
		const mockEmit = t.vi.fn();
		mockEmit.mockImplementation((event: string, payload?: unknown) => {
			if (event === "otp_required" && payload && typeof payload === "object" && "submit" in payload) {
				(payload as { submit: (otp: string) => void }).submit("123456"); // Simulate correct OTP submission
			}
		});
		context.emit = mockEmit as any;

		await handler.execute(mockSession, mockRequest);

		t.expect(context.transport.connect).toHaveBeenCalledOnce();
		t.expect(context.transport.subscribe).toHaveBeenCalledWith(mockRequest.channel);
		t.expect(context.emit).toHaveBeenCalledWith("otp_required", t.expect.any(Object));
		t.expect(context.sendMessage).toHaveBeenCalledWith(t.expect.stringContaining("session:secure-channel"), { type: "handshake-ack" });
		t.expect(context.sessionstore.set).toHaveBeenCalledOnce();
		t.expect(context.transport.clear).toHaveBeenCalledWith(mockRequest.channel);
		t.expect(context.state).toBe("CONNECTED");
		t.expect(context.emit).toHaveBeenCalledWith("connected");
	});

	t.test("should emit otp_required event with submit function", async () => {
		const mockEmit = t.vi.fn();
		mockEmit.mockImplementation((event: string, payload?: unknown) => {
			if (event === "otp_required" && payload && typeof payload === "object" && "submit" in payload) {
				// Just verify the structure is correct, then submit correct OTP to continue
				t.expect(payload).toHaveProperty("submit");
				t.expect(payload).toHaveProperty("cancel");
				t.expect(payload).toHaveProperty("deadline");
				(payload as { submit: (otp: string) => void }).submit("123456"); // Submit correct OTP
			}
		});
		context.emit = mockEmit as any;

		await handler.execute(mockSession, mockRequest);

		t.expect(mockEmit).toHaveBeenCalledWith(
			"otp_required",
			t.expect.objectContaining({
				submit: t.expect.any(Function),
				cancel: t.expect.any(Function),
				deadline: t.expect.any(Number),
			}),
		);
	});

	t.test("should throw if max OTP attempts are reached", async () => {
		let submitFn: ((otp: string) => Promise<void>) | undefined;
		const mockEmit = t.vi.fn();
		mockEmit.mockImplementation((event: string, payload?: unknown) => {
			if (event === "otp_required" && payload && typeof payload === "object" && "submit" in payload) {
				submitFn = (payload as { submit: (otp: string) => Promise<void> }).submit;
			}
		});
		context.emit = mockEmit as any;

		const executePromise = handler.execute(mockSession, mockRequest);

		// Wait a bit for the emit to be called
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Make incorrect attempts - the 3rd attempt should cause the promise to reject
		if (submitFn) {
			try {
				await submitFn("wrong1");
			} catch (e) {
				t.expect((e as Error).message).toMatch("Incorrect OTP");
			}
			try {
				await submitFn("wrong2");
			} catch (e) {
				t.expect((e as Error).message).toMatch("Incorrect OTP");
			}
			try {
				await submitFn("wrong3");
			} catch (e) {
				t.expect((e as Error).message).toMatch("Maximum OTP attempts reached");
			}
		}

		await t.expect(executePromise).rejects.toThrow("Maximum OTP attempts reached");
	});

	t.test("should throw if handshake offer is missing OTP details", async () => {
		// Mock offer without OTP
		const invalidOffer = { channelId: "secure-channel", publicKeyB64: "pubkey" };
		context.once = t.vi.fn((event, callback) => {
			if (event === "handshake_offer_received") {
				setTimeout(() => callback(invalidOffer), 10);
			}
			return context;
		});

		await t.expect(handler.execute(mockSession, mockRequest)).rejects.toThrow("Handshake offer is missing OTP details");
	});

	t.test("should throw if OTP has already expired", async () => {
		// Mock offer with expired deadline
		const expiredOffer = {
			...mockOffer,
			deadline: Date.now() - 1000, // 1 second ago
		};
		context.once = t.vi.fn((event, callback) => {
			if (event === "handshake_offer_received") {
				setTimeout(() => callback(expiredOffer), 10);
			}
			return context;
		});

		await t.expect(handler.execute(mockSession, mockRequest)).rejects.toThrow("The OTP has already expired");
	});

	t.test("should throw if handshake offer is not received in time", async () => {
		mockRequest.expiresAt = Date.now() + 5; // Very short expiry
		context.once = t.vi.fn(); // Do not resolve the handshake offer

		await t.expect(handler.execute(mockSession, mockRequest)).rejects.toThrow(/Did not receive handshake offer/);
	});
});
