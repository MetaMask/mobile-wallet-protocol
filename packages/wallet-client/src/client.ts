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

/**
 * Configuration options for the WalletClient.
 */
export interface WalletClientOptions {
	/** An initialized transport layer for communication. */
	transport: ITransport;
	/** An initialized session store for persistent session management. */
	sessionstore: ISessionStore;
}

/**
 * Manages the connection from the wallet's perspective. It responds to dApp
 * connection requests, handles the secure OTP-based handshake, and manages
 * the lifecycle of the communication session.
 */
export class WalletClient extends BaseClient {
	private readonly otpTimeoutMs = 60 * 1000; // 1 minute;

	public override on(event: "display_otp", listener: (otp: string, deadline: number) => void): this;
	public override on(event: "connected" | "disconnected", listener: () => void): this;
	public override on(event: "message", listener: (payload: unknown) => void): this;
	public override on(event: "error", listener: (error: Error) => void): this;
	public override on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	constructor(options: WalletClientOptions) {
		super(options.transport, new KeyManager(), options.sessionstore);
	}

	/**
	 * Establishes a secure session with a dApp based on a received `SessionRequest`.
	 * This process involves:
	 * 1. Generating a new keypair and a secure communication channel.
	 * 2. Emitting a `display_otp` event for the user to see the One-Time Password.
	 * 3. Sending a handshake offer with the OTP to the dApp.
	 * 4. Waiting for the dApp to acknowledge the handshake.
	 * 5. Finalizing and persisting the secure session.
	 *
	 * @param options - Contains the `sessionRequest` from the dApp.
	 * @returns A promise that resolves when the session is successfully established.
	 * @throws {SessionError} If the client is not in a `DISCONNECTED` state or if the
	 * `sessionRequest` is expired or the handshake times out.
	 */
	public async connect(options: { sessionRequest: SessionRequest }): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		const request = options.sessionRequest;
		if (Date.now() > request.expiresAt) throw new SessionError(ErrorCode.REQUEST_EXPIRED, "Session request expired");

		try {
			this.session = this.createSession(request);
			await this.transport.connect();
			await this.transport.subscribe(request.channel); // Subscribe to the dApp's handshake channel
			await this.transport.subscribe(this.session.channel); // Subscribe to our new secure channel
			await this.performHandshake(request.channel);
			await this.finalizeConnection(request.channel);
		} catch (error) {
			await this.disconnect();
			throw error;
		}
	}

	/**
	 * Sends a response payload to the connected dApp.
	 *
	 * @param payload - The response payload to send.
	 * @throws {SessionError} If the client is not in a `CONNECTED` state.
	 */
	public async sendResponse(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED || !this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send response: not connected.");
		await this.sendMessage(this.session.channel, { type: "message", payload });
	}

	/**
	 * Routes incoming messages based on their type. It handles handshake
	 * acknowledgements and standard application messages.
	 */
	protected handleMessage(message: ProtocolMessage): void {
		if (message.type === "handshake-ack") {
			// Internal event to resolve the connect() promise chain.
			this.emit("handshake-ack-received");
			return;
		}
		if (message.type === "message") {
			this.emit("message", message.payload);
		}
	}

	/**
	 * Orchestrates the handshake sequence: generate OTP, send offer, and wait for acknowledgment.
	 * @param channel - The handshake channel to send the offer on.
	 */
	private async performHandshake(channel: string): Promise<void> {
		const { otp, deadline } = this.generateOtpWithDeadline();
		this.emit("display_otp", otp, deadline);
		await this.sendHandshakeOffer(channel, otp, deadline);
		await this.waitForHandshakeAck(deadline);
	}

	/**
	 * Sends the `handshake-offer` message containing the public key, new channel ID, and OTP.
	 * @param channel - The handshake channel to publish the offer to.
	 * @param otp - The one-time password for verification.
	 * @param deadline - The expiration timestamp for the OTP.
	 */
	private async sendHandshakeOffer(channel: string, otp: string, deadline: number): Promise<void> {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);

		const handshakePayload: HandshakeOfferPayload = {
			publicKeyB64: fromUint8Array(this.session.keyPair.publicKey),
			channelId: this.session.channel.replace("session:", ""),
			otp,
			deadline,
		};

		await this.sendMessage(channel, { type: "handshake-offer", payload: handshakePayload });
	}

	/**
	 * Completes the connection by persisting the session, cleaning up the
	 * temporary handshake channel, and transitioning to the `CONNECTED` state.
	 * @param channel - The temporary channel used for the initial handshake.
	 */
	private async finalizeConnection(channel: string): Promise<void> {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);
		await this.sessionstore.set(this.session);
		await this.transport.clear(channel);
		this.state = ClientState.CONNECTED;
		this.emit("connected");
	}

	/**
	 * Creates a new session object for the wallet based on the dApp's request.
	 * This includes generating a new key pair and a unique secure channel ID.
	 * @param request - The `SessionRequest` from the dApp.
	 * @returns A new `Session` object.
	 */
	private createSession(request: SessionRequest): Session {
		return {
			id: request.id,
			channel: `session:${uuid()}`, // Create a new, unique channel for secure communication
			keyPair: this.keymanager.generateKeyPair(),
			theirPublicKey: toUint8Array(request.publicKeyB64),
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};
	}

	/**
	 * Generates a 6-digit OTP and its expiration timestamp.
	 * @returns An object containing the OTP string and its deadline.
	 */
	private generateOtpWithDeadline(): { otp: string; deadline: number } {
		const otp = Math.floor(100000 + Math.random() * 900000).toString();
		const deadline = Date.now() + this.otpTimeoutMs;
		return { otp, deadline };
	}

	/**
	 * Waits for a `handshake-ack` message from the dApp.
	 *
	 * @param deadline - The timestamp when the acknowledgment must be received.
	 * @returns A promise that resolves when the ack is received.
	 * @throws {SessionError} if the ack is not received before the deadline.
	 */
	private waitForHandshakeAck(deadline: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeoutDuration = deadline - Date.now();
			if (timeoutDuration <= 0) {
				return reject(new SessionError(ErrorCode.OTP_ENTRY_TIMEOUT, "Handshake timed out before it could begin."));
			}

			const timeoutId = setTimeout(() => {
				this.off("handshake-ack-received", onAckReceived);
				reject(new SessionError(ErrorCode.OTP_ENTRY_TIMEOUT, "DApp did not acknowledge the handshake in time."));
			}, timeoutDuration);

			const onAckReceived = () => {
				clearTimeout(timeoutId);
				resolve();
			};

			this.once("handshake-ack-received", onAckReceived);
		});
	}
}
