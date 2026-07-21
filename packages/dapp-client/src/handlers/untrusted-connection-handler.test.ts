/** biome-ignore-all lint/suspicious/noExplicitAny: test code */
import { ClientState, type HandshakeOfferPayload, type Session, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import * as t from "vitest";
import { vi } from "vitest";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";
import { UntrustedConnectionHandler } from "./untrusted-connection-handler";

function createMockDappHandlerContext(overrides: Partial<IConnectionHandlerContext> = {}): IConnectionHandlerContext {
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
		keymanager: {
			generateKeyPair: vi.fn(),
			encrypt: vi.fn(),
			decrypt: vi.fn(),
			validatePeerKey: vi.fn(),
		},
		emit: vi.fn(),
		once: vi.fn(),
		off: vi.fn(),
		sendMessage: vi.fn(),
		...overrides,
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
			publicKeyB64: "Aqurq6urq6urq6urq6urq6urq6urq6urq6urq6urq6ur",
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

	t.describe("otp-display-grant", () => {
		function setupStrictRequest(): void {
			mockRequest.capabilities = { otpDisplayGrant: true };
			mockOffer.otpDisplayGrantRequired = true;
		}

		function setupOtpSubmitMock(): void {
			const mockEmit = t.vi.fn();
			mockEmit.mockImplementation((event: string, payload?: unknown) => {
				if (event === "otp_required" && payload && typeof payload === "object" && "submit" in payload) {
					(payload as { submit: (otp: string) => void }).submit("123456");
				}
			});
			context.emit = mockEmit as any;
		}

		t.test("should send otp-display-grant before otp_required in strict flow", async () => {
			setupStrictRequest();

			const callTimeline: string[] = [];
			context.emit = t.vi.fn((event: string, payload?: unknown) => {
				callTimeline.push(`emit:${event}`);
				if (event === "otp_required" && payload && typeof payload === "object" && "submit" in payload) {
					(payload as { submit: (otp: string) => void }).submit("123456");
				}
			}) as typeof context.emit;

			context.sendMessage = t.vi.fn(async (_channel: string, message: { type: string }) => {
				callTimeline.push(`send:${message.type}`);
			}) as typeof context.sendMessage;

			await handler.execute(mockSession, mockRequest);

			const grantIndex = callTimeline.indexOf("send:otp-display-grant");
			const otpRequiredIndex = callTimeline.indexOf("emit:otp_required");
			t.expect(grantIndex).toBeGreaterThanOrEqual(0);
			t.expect(otpRequiredIndex).toBeGreaterThanOrEqual(0);
			t.expect(grantIndex).toBeLessThan(otpRequiredIndex);
		});

		t.test("should complete strict flow successfully", async () => {
			setupStrictRequest();
			setupOtpSubmitMock();

			await handler.execute(mockSession, mockRequest);

			const subscribeMock = context.transport.subscribe as t.Mock;
			t.expect(subscribeMock.mock.calls.map((call) => call[0])).toEqual(["handshake:123", "session:secure-channel"]);
			t.expect(context.sendMessage).toHaveBeenCalledWith("handshake:123", { type: "otp-display-grant" });
			t.expect(context.sendMessage).toHaveBeenCalledWith("session:secure-channel", { type: "handshake-ack" });
			t.expect(context.state).toBe("CONNECTED");
		});

		t.test("should reject offer without otpDisplayGrantRequired when strict mode is required", async () => {
			mockRequest.capabilities = { otpDisplayGrant: true };

			await t.expect(handler.execute(mockSession, mockRequest)).rejects.toThrow("Wallet does not support OTP display grant required by this dApp.");
		});

		t.test("should keep legacy flow when strict mode is not required", async () => {
			setupOtpSubmitMock();

			const subscribeMock = context.transport.subscribe as t.Mock;
			await handler.execute(mockSession, mockRequest);

			t.expect(subscribeMock.mock.calls.map((call) => call[0])).toEqual(["handshake:123", "session:secure-channel"]);
			t.expect(context.sendMessage).not.toHaveBeenCalledWith(t.expect.any(String), { type: "otp-display-grant" });
		});

		t.test("should still reject incorrect OTP in strict mode", async () => {
			setupStrictRequest();

			let submitFn: ((otp: string) => Promise<void>) | undefined;
			context.emit = t.vi.fn((event: string, payload?: unknown) => {
				if (event === "otp_required" && payload && typeof payload === "object" && "submit" in payload) {
					submitFn = (payload as { submit: (otp: string) => Promise<void> }).submit;
				}
			}) as typeof context.emit;

			const executePromise = handler.execute(mockSession, mockRequest);
			await new Promise((resolve) => setTimeout(resolve, 20));

			t.expect(submitFn).toBeDefined();
			await t.expect(submitFn!("wrong")).rejects.toThrow("Incorrect OTP");
			await submitFn!("123456");
			await executePromise;
		});

		t.test("should throw if max OTP attempts are reached in strict mode", async () => {
			setupStrictRequest();

			let submitFn: ((otp: string) => Promise<void>) | undefined;
			context.emit = t.vi.fn((event: string, payload?: unknown) => {
				if (event === "otp_required" && payload && typeof payload === "object" && "submit" in payload) {
					submitFn = (payload as { submit: (otp: string) => Promise<void> }).submit;
				}
			}) as typeof context.emit;

			const executePromise = handler.execute(mockSession, mockRequest);
			await new Promise((resolve) => setTimeout(resolve, 20));

			t.expect(context.sendMessage).toHaveBeenCalledWith("handshake:123", { type: "otp-display-grant" });

			if (submitFn) {
				for (const wrongOtp of ["wrong1", "wrong2"]) {
					await t.expect(submitFn(wrongOtp)).rejects.toThrow("Incorrect OTP");
				}
				try {
					await submitFn("wrong3");
				} catch (e) {
					t.expect((e as Error).message).toMatch("Maximum OTP attempts reached");
				}
			}

			await t.expect(executePromise).rejects.toThrow("Maximum OTP attempts reached");
		});

		t.test("should throw if OTP has already expired in strict mode", async () => {
			setupStrictRequest();
			mockOffer.deadline = Date.now() - 1000;

			await t.expect(handler.execute(mockSession, mockRequest)).rejects.toThrow("The OTP has already expired");
			t.expect(context.sendMessage).toHaveBeenCalledWith("handshake:123", { type: "otp-display-grant" });
		});

		t.test("should apply wallet public key from offer before sending otp-display-grant", async () => {
			setupStrictRequest();
			setupOtpSubmitMock();

			await handler.execute(mockSession, mockRequest);

			t.expect(context.keymanager.validatePeerKey).toHaveBeenCalled();
			const sessionAfterGrant = context.session;
			t.expect(sessionAfterGrant?.theirPublicKey).toEqual(t.expect.any(Uint8Array));
			t.expect(sessionAfterGrant?.channel).toBe("session:secure-channel");
		});
	});
});
