import {
	BaseClient,
	ClientState,
	DEFAULT_SESSION_TTL,
	ErrorCode,
	type IKeyManager,
	type ISessionStore,
	type ITransport,
	type ProtocolMessage,
	type Session,
	SessionError,
	type SessionRequest,
	validateSecp256k1PublicKey,
} from "@metamask/mobile-wallet-protocol-core";
import { base64ToBytes } from "@metamask/utils";
import { v4 as uuid } from "uuid";
import type { IConnectionHandler } from "./domain/connection-handler";
import type { IConnectionHandlerContext } from "./domain/connection-handler-context";
import { TrustedConnectionHandler } from "./handlers/trusted-connection-handler";
import { UntrustedConnectionHandler } from "./handlers/untrusted-connection-handler";

/**
 * Configuration options for the WalletClient.
 */
export interface WalletClientOptions {
	/** An initialized transport layer for communication. */
	transport: ITransport;
	/** An initialized session store for persistent session management. */
	sessionstore: ISessionStore;
	/** An initialized key manager for cryptographic operations. */
	keymanager: IKeyManager;
}

/**
 * Manages the connection from the wallet's perspective. It responds to dApp
 * connection requests, handles secure handshakes, and manages the lifecycle of
 * the communication session.
 *
 * The client automatically chooses the appropriate connection handler based on
 * the connection mode specified in the SessionRequest.
 */
export class WalletClient extends BaseClient {
	public override on(event: "display_otp", listener: (otp: string, deadline: number) => void): this;
	public override on(event: "connected" | "disconnected", listener: () => void): this;
	public override on(event: "message", listener: (payload: unknown) => void): this;
	public override on(event: "error", listener: (error: Error) => void): this;
	// biome-ignore lint/suspicious/noExplicitAny: used for event emitter
	public override on(event: string | symbol, listener: (...args: any[]) => void): this {
		// biome-ignore lint/suspicious/noExplicitAny: used for event emitter
		return super.on(event as any, listener);
	}

	constructor(options: WalletClientOptions) {
		super(options.transport, options.keymanager, options.sessionstore);
	}

	/**
	 * Establishes a secure session with a dApp based on a received `SessionRequest`.
	 * The process differs based on the connection mode in the request:
	 *
	 * **Trusted Mode** (same-device/trusted context):
	 * 1. Generates a new keypair and secure communication channel
	 * 2. Sends a handshake offer without OTP
	 * 3. Waits for dApp acknowledgment
	 * 4. Finalizes secure session
	 *
	 * **Untrusted Mode** (high-security):
	 * 1. Generates a new keypair and secure communication channel
	 * 2. Emits a `display_otp` event for the user to see the One-Time Password
	 * 3. Sends a handshake offer with the OTP to the dApp
	 * 4. Waits for the dApp to acknowledge the handshake
	 * 5. Finalizes and persists the secure session
	 *
	 * @param options - Contains the `sessionRequest` from the dApp
	 * @returns A promise that resolves when the session is successfully established
	 * @throws {SessionError} If the client is not in a `DISCONNECTED` state, if the
	 * `sessionRequest` is expired, or if the handshake times out
	 */
	public async connect(options: { sessionRequest: SessionRequest }): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		const request = options.sessionRequest;
		if (Date.now() > request.expiresAt) throw new SessionError(ErrorCode.REQUEST_EXPIRED, "Session request expired");

		const session = this._createSession(request);

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
			handleMessage: this.handleMessage.bind(this),
		};

		const handler: IConnectionHandler = request.mode === "trusted" ? new TrustedConnectionHandler(context) : new UntrustedConnectionHandler(context);

		try {
			await handler.execute(session, request);
		} catch (error) {
			this.emit("error", error);
			await this.disconnect();
			throw error;
		}
	}

	/**
	 * Sends a response payload to the connected dApp.
	 *
	 * @param payload - The response payload to send
	 * @throws {SessionError} If the client is not in a `CONNECTED` state
	 */
	public async sendResponse(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED || !this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send response: not connected.");
		await this.sendMessage(this.session.channel, { type: "message", payload });
	}

	/**
	 * Routes incoming messages based on their type. It handles handshake
	 * acknowledgements and standard application messages.
	 *
	 * @param message - The incoming message to handle
	 */
	protected handleMessage(message: ProtocolMessage): void {
		if (message.type === "handshake-ack") {
			// Internal event to resolve the connection handler
			this.emit("handshake_ack_received");
			return;
		}
		if (message.type === "message") {
			this.emit("message", message.payload);
		}
	}

	/**
	 * Creates a new session object for the wallet based on the dApp's request.
	 * This includes generating a new key pair and a unique secure channel ID.
	 *
	 * @param request - The `SessionRequest` from the dApp
	 * @returns A new `Session` object
	 */
	private _createSession(request: SessionRequest): Session {
		const theirPublicKey = base64ToBytes(request.publicKeyB64);
		validateSecp256k1PublicKey(theirPublicKey);
		return {
			id: request.id,
			channel: `session:${uuid()}`, // Create a new, unique channel for secure communication
			keyPair: this.keymanager.generateKeyPair(),
			theirPublicKey,
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};
	}
}
