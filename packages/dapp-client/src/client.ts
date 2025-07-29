import {
	BaseClient,
	ClientState,
	DEFAULT_SESSION_TTL,
	ErrorCode,
	type HandshakeOfferPayload,
	type ISessionStore,
	type ITransport,
	KeyManager,
	type ProtocolMessage,
	type Session,
	SessionError,
	type SessionRequest,
} from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";
import { v4 as uuid } from "uuid";

const SESSION_REQUEST_TTL = 60 * 1000; // 60 seconds

/**
 * Configuration options for the DappClient.
 */
export interface DappClientOptions {
	/** An initialized transport layer for communication. */
	transport: ITransport;
	/** An initialized session store for persistent session management. */
	sessionstore: ISessionStore;
}

/**
 * Payload for the 'otp_required' event, providing methods to interact
 * with the One-Time Password (OTP) verification process.
 */
export type OtpRequiredPayload = {
	/**
	 * Submits the One-Time Password (OTP) for verification.
	 * @param otp - The 6-digit OTP provided by the user.
	 * @returns A promise that resolves if the OTP is correct, or rejects with an
	 * error if it's incorrect or if max attempts are reached.
	 */
	submit: (otp: string) => Promise<void>;
	/** Cancels the OTP entry process and the connection attempt. */
	cancel: () => void;
	/** The timestamp (in milliseconds) when the OTP will expire. */
	deadline: number;
};

/**
 * Manages the connection from the dApp's perspective. It handles session
 * initiation, secure communication via an OTP handshake, and request/response
 * messaging with a wallet.
 */
export class DappClient extends BaseClient {
	private readonly otpAttempts = 3;
	private timeoutId: NodeJS.Timeout | null = null;

	public override on(event: "session_request", listener: (request: SessionRequest) => void): this;
	public override on(event: "otp_required", listener: (payload: OtpRequiredPayload) => void): this;
	public override on(event: "connected" | "disconnected", listener: () => void): this;
	public override on(event: "message", listener: (payload: unknown) => void): this;
	public override on(event: "error", listener: (error: Error) => void): this;
	public override on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	constructor(options: DappClientOptions) {
		super(options.transport, new KeyManager(), options.sessionstore);
	}

	/**
	 * Initiates a new session with a wallet. This process involves:
	 * 1. Emitting a `session_request` event (typically with a QR code/deep-link payload).
	 * 2. Waiting for the wallet to send a handshake offer.
	 * 3. Emitting an `otp_required` event for the user to verify the connection.
	 * 4. Finalizing the secure, encrypted session.
	 *
	 * @returns A promise that resolves when the session is successfully established.
	 * @throws {SessionError} If the client is not in a `DISCONNECTED` state or if the
	 * connection process times out.
	 */
	public async connect(): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		const { pendingSession, request } = this.createPendingSessionAndRequest();
		this.session = pendingSession;
		this.emit("session_request", request);

		try {
			await this.transport.connect();
			await this.transport.subscribe(request.channel);
			const offer = await this.waitForHandshakeOffer(request.expiresAt);
			await this.handleOtpInput(offer);
			await this.updateSessionAndAcknowledge(pendingSession, offer);
			await this.finalizeConnection(request.channel);
		} catch (error) {
			await this.disconnect();
			throw error;
		}
	}

	/**
	 * Disconnects the client and clears any pending connection timeouts.
	 */
	public async disconnect(): Promise<void> {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		await super.disconnect();
	}

	/**
	 * Sends a request payload to the connected wallet.
	 *
	 * @param payload - The request payload to send to the wallet.
	 * @throws {SessionError} If the client is not in a `CONNECTED` state.
	 */
	public async sendRequest(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED || !this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send request: not connected.");
		await this.sendMessage(this.session.channel, { type: "message", payload });
	}

	/**
	 * Routes incoming messages based on the client's connection state.
	 * During connection, it handles handshake messages. Once connected, it
	 * handles standard application messages.
	 */
	protected handleMessage(message: ProtocolMessage): void {
		if (this.state === ClientState.CONNECTING && message.type === "handshake-offer") {
			// Internal event to pass the offer to the connect() promise chain.
			this.emit("handshake-offer-received", message.payload);
		} else if (this.state === ClientState.CONNECTED && message.type === "message") {
			this.emit("message", message.payload);
		}
	}

	/**
	 * Creates a temporary session object and the corresponding `SessionRequest`
	 * payload to be shared with the wallet.
	 */
	private createPendingSessionAndRequest(): { pendingSession: Session; request: SessionRequest } {
		const id = uuid();
		const keyPair = this.keymanager.generateKeyPair();

		// The session is "pending" because the channel and theirPublicKey are unknown until the handshake.
		const pendingSession: Session = {
			id,
			channel: "", // To be determined by the wallet's handshake offer.
			keyPair,
			theirPublicKey: new Uint8Array(0), // Placeholder, will be updated.
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};

		const request: SessionRequest = {
			id,
			channel: `handshake:${id}`,
			publicKeyB64: fromUint8Array(keyPair.publicKey),
			expiresAt: Date.now() + SESSION_REQUEST_TTL,
		};

		return { pendingSession, request };
	}

	/**
	 * Waits for a `handshake-offer` message from the wallet on the handshake channel.
	 *
	 * @param requestExpiry - The timestamp when the session request expires.
	 * @returns A promise that resolves with the `HandshakeOfferPayload`.
	 * @throws {SessionError} If the offer is not received before the request expires.
	 */
	private waitForHandshakeOffer(requestExpiry: number): Promise<HandshakeOfferPayload> {
		return new Promise((resolve, reject) => {
			const timeoutDuration = requestExpiry - Date.now();
			if (timeoutDuration <= 0) {
				return reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Session request expired before wallet could connect."));
			}

			this.timeoutId = setTimeout(() => {
				this.off("handshake-offer-received", onOfferReceived);
				reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Did not receive handshake offer from wallet in time."));
			}, timeoutDuration);

			const onOfferReceived = (payload: HandshakeOfferPayload) => {
				if (this.timeoutId) clearTimeout(this.timeoutId);
				resolve(payload);
			};

			this.once("handshake-offer-received", onOfferReceived);
		});
	}

	/**
	 * Manages the OTP verification step by emitting the `otp_required` event and
	 * waiting for the user to submit the correct OTP.
	 *
	 * @param offer - The handshake offer from the wallet containing the OTP.
	 * @throws {SessionError} If the OTP is incorrect after max attempts, the OTP expires,
	 * or the user cancels.
	 */
	private handleOtpInput(offer: HandshakeOfferPayload): Promise<void> {
		return new Promise((resolve, reject) => {
			if (Date.now() > offer.deadline) {
				return reject(new SessionError(ErrorCode.OTP_ENTRY_TIMEOUT, "The OTP has already expired."));
			}

			let attempts = 0;
			const submit = async (otp: string): Promise<void> => {
				if (otp !== offer.otp) {
					attempts++;
					if (attempts >= this.otpAttempts) {
						reject(new SessionError(ErrorCode.OTP_MAX_ATTEMPTS_REACHED, "Maximum OTP attempts reached."));
					} else {
						throw new SessionError(ErrorCode.OTP_INCORRECT, `Incorrect OTP. ${this.otpAttempts - attempts} attempts remaining.`);
					}
					return;
				}
				resolve(); // OTP is correct
			};

			const cancel = () => reject(new Error("User cancelled OTP entry."));
			this.emit("otp_required", { submit, cancel, deadline: offer.deadline });
		});
	}

	/**
	 * Updates the pending session with the final details from the wallet's offer
	 * and sends a `handshake-ack` to the wallet on the new secure channel.
	 *
	 * @param pendingSession - The temporary session object.
	 * @param offer - The handshake offer payload from the wallet.
	 */
	private async updateSessionAndAcknowledge(pendingSession: Session, offer: HandshakeOfferPayload): Promise<void> {
		this.session = { ...pendingSession, channel: `session:${offer.channelId}`, theirPublicKey: toUint8Array(offer.publicKeyB64) };
		await this.transport.subscribe(this.session.channel);
		await this.sendMessage(this.session.channel, { type: "handshake-ack" });
	}

	/**
	 * Completes the connection by persisting the session, cleaning up the
	 * temporary handshake channel, and transitioning to the `CONNECTED` state.
	 *
	 * @param handshakeChannel - The temporary channel used for the initial handshake.
	 */
	private async finalizeConnection(handshakeChannel: string): Promise<void> {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);
		await this.sessionstore.set(this.session);
		await this.transport.clear(handshakeChannel);
		this.state = ClientState.CONNECTED;
		this.emit("connected");
	}
}
