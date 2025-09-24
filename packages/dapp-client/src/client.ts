import {
	BaseClient,
	ClientState,
	type ConnectionMode,
	DEFAULT_SESSION_TTL,
	ErrorCode,
	type IKeyManager,
	type ISessionStore,
	type ITransport,
	type Message,
	type ProtocolMessage,
	type Session,
	SessionError,
	type SessionRequest,
} from "@metamask/mobile-wallet-protocol-core";
import { bytesToBase64 } from "@metamask/utils";
import { v4 as uuid } from "uuid";
import type { IConnectionHandler } from "./domain/connection-handler";
import type { IConnectionHandlerContext } from "./domain/connection-handler-context";
import { TrustedConnectionHandler } from "./handlers/trusted-connection-handler";
import { UntrustedConnectionHandler } from "./handlers/untrusted-connection-handler";

const SESSION_REQUEST_TTL = 60 * 1000; // 60 seconds

/**
 * Configuration options for the DappClient.
 */
export interface DappClientOptions {
	/** An initialized transport layer for communication. */
	transport: ITransport;
	/** An initialized session store for persistent session management. */
	sessionstore: ISessionStore;
	/** An initialized key manager for cryptographic operations. */
	keymanager: IKeyManager;
}

/**
 * Options for configuring the connection behavior.
 */
export interface DappConnectOptions {
	/** The connection mode: 'trusted' for same-device flows, 'untrusted' for high-security OTP flows. */
	mode?: ConnectionMode;
	/** An optional unencrypted payload to be sent as the first message upon connection. */
	initialPayload?: unknown;
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
 * initiation, secure communication, and request/response messaging with a wallet.
 *
 * Supports both 'trusted' (streamlined, same-device) and 'untrusted' (OTP-based)
 * connection flows through self-contained handlers.
 */
export class DappClient extends BaseClient {
	public override on(event: "session_request", listener: (request: SessionRequest) => void): this;
	public override on(event: "otp_required", listener: (payload: OtpRequiredPayload) => void): this;
	public override on(event: "connected" | "disconnected", listener: () => void): this;
	public override on(event: "message", listener: (payload: unknown) => void): this;
	public override on(event: "error", listener: (error: Error) => void): this;
	// biome-ignore lint/suspicious/noExplicitAny: used for event emitter
	public override on(event: string | symbol, listener: (...args: any[]) => void): this {
		// biome-ignore lint/suspicious/noExplicitAny: used for event emitter
		return super.on(event as any, listener);
	}

	constructor(options: DappClientOptions) {
		super(options.transport, options.keymanager, options.sessionstore);
	}

	/**
	 * Initiates a new session with a wallet. The process differs based on the connection mode:
	 *
	 * **Trusted Mode** (same-device/trusted context):
	 * 1. Emits a `session_request` event
	 * 2. Waits for wallet handshake offer
	 * 3. Automatically finalizes secure session
	 *
	 * **Untrusted Mode** (high-security):
	 * 1. Emits a `session_request` event
	 * 2. Waits for wallet handshake offer with OTP
	 * 3. Emits `otp_required` event for user verification
	 * 4. Finalizes secure, encrypted session after OTP validation
	 *
	 * @param options - Connection options including the desired mode
	 * @returns A promise that resolves when the session is successfully established
	 * @throws {SessionError} If the client is not in a `DISCONNECTED` state or if the
	 * connection process fails
	 */
	public async connect(options: DappConnectOptions = {}): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		const { mode = "untrusted", initialPayload } = options;
		const { pendingSession, request } = this._createPendingSessionAndRequest(mode, initialPayload);
		this.session = pendingSession;
		this.emit("session_request", request);

		const self = this;
		const context: IConnectionHandlerContext = {
			transport: this.transport,
			sessionstore: this.sessionstore,
			get session() {
				return self.session;
			},
			set session(session: Session | null) {
				self.session = session;
			},
			get state() {
				return self.state;
			},
			set state(state: ClientState) {
				self.state = state;
			},
			emit: this.emit.bind(this),
			once: this.once.bind(this),
			off: this.off.bind(this),
			sendMessage: this.sendMessage.bind(this),
		};

		const handler: IConnectionHandler = mode === "trusted" ? new TrustedConnectionHandler(context) : new UntrustedConnectionHandler(context);

		try {
			await handler.execute(pendingSession, request);
		} catch (error) {
			this.emit("error", error);
			await this.disconnect();
			throw error;
		}
	}

	/**
	 * Sends a request payload to the connected wallet.
	 *
	 * @param payload - The request payload to send to the wallet
	 * @throws {SessionError} If the client is not in a `CONNECTED` state
	 */
	public async sendRequest(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED || !this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send request: not connected.");
		await this.sendMessage(this.session.channel, { type: "message", payload });
	}

	/**
	 * Routes incoming messages based on the client's connection state.
	 * During connection, it handles handshake messages. Once connected, it
	 * handles standard application messages.
	 *
	 * @param message - The incoming message to handle
	 */
	protected handleMessage(message: ProtocolMessage): void {
		if (this.state === ClientState.CONNECTING && message.type === "handshake-offer") {
			// Internal event to pass the offer to the connection handler
			this.emit("handshake_offer_received", message.payload);
		} else if (this.state === ClientState.CONNECTED && message.type === "message") {
			this.emit("message", message.payload);
		}
	}

	/**
	 * Creates a temporary session object and the corresponding `SessionRequest`
	 * payload to be shared with the wallet.
	 *
	 * @param mode - The connection mode to use for this session
	 * @returns An object containing the pending session and session request
	 */
	private _createPendingSessionAndRequest(mode: ConnectionMode, initialPayload?: unknown): { pendingSession: Session; request: SessionRequest } {
		const id = uuid();
		const keyPair = this.keymanager.generateKeyPair();

		// The session is "pending" because the channel and theirPublicKey are unknown until the handshake
		const pendingSession: Session = {
			id,
			channel: "", // To be determined by the wallet's handshake offer
			keyPair,
			theirPublicKey: new Uint8Array(0), // Placeholder, will be updated
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};

		const message: Message | undefined = initialPayload ? { type: "message", payload: initialPayload } : undefined;

		const request: SessionRequest = {
			id,
			mode,
			channel: `handshake:${id}`,
			publicKeyB64: bytesToBase64(keyPair.publicKey),
			expiresAt: Date.now() + SESSION_REQUEST_TTL,
			initialMessage: message,
		};

		return { pendingSession, request };
	}
}
