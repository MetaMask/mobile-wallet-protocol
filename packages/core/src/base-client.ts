import EventEmitter from "eventemitter3";
import { ClientState } from "./domain/client-state";
import { CryptoError, ErrorCode, SessionError, TransportError } from "./domain/errors";
import type { IKeyManager } from "./domain/key-manager";
import type { ProtocolMessage } from "./domain/protocol-message";
import type { Session } from "./domain/session";
import type { ISessionStore } from "./domain/session-store";
import type { ITransport } from "./domain/transport";

/**
 * An abstract client that provides the core logic for establishing and managing
 * secure, session-based communication. It handles encryption, message transport,
 * and session lifecycle events.
 * Subclasses must implement the `handleMessage` method to process incoming data.
 */
export abstract class BaseClient extends EventEmitter {
	protected transport: ITransport;
	protected keymanager: IKeyManager;
	protected sessionstore: ISessionStore;
	protected session: Session | null = null;
	protected _state: ClientState = ClientState.DISCONNECTED;

	public override on(event: "connected" | "disconnected", listener: () => void): this;
	public override on(event: "error", listener: (error: Error) => void): this;
	public override on(event: "message", listener: (payload: unknown) => void): this;
	// biome-ignore lint/suspicious/noExplicitAny: used for event listeners
	public override on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	/**
	 * Initializes the BaseClient with its core dependencies.
	 *
	 * @param transport - The transport layer for communication.
	 * @param keymanager - The key manager for cryptographic operations.
	 * @param sessionstore - The persistent store for session management.
	 */
	constructor(transport: ITransport, keymanager: IKeyManager, sessionstore: ISessionStore) {
		super();
		this.transport = transport;
		this.keymanager = keymanager;
		this.sessionstore = sessionstore;

		this.transport.on("error", (error) => this.emit("error", error));

		this.transport.on("message", async (payload) => {
			if (!this.session?.keyPair.privateKey) return;
			const message = await this.decryptMessage(payload.data);
			if (message) this.handleMessage(message);
		});
	}

	public get state(): ClientState {
		return this._state;
	}

	protected set state(state: ClientState) {
		this._state = state;
	}

	/**
	 * Proactively refreshes the underlying transport connection.
	 * This is the recommended method for mobile clients to call when the application
	 * returns to the foreground to ensure the connection is not stale.
	 */
	public async reconnect(): Promise<void> {
		if (this.state === ClientState.CONNECTING || !this.session || !this.transport.reconnect) return;

		try {
			this.state = ClientState.CONNECTING;
			await this.transport.reconnect();
			this.state = ClientState.CONNECTED;
			this.emit("connected");
		} catch {
			this.state = ClientState.DISCONNECTED;
			throw new TransportError(ErrorCode.TRANSPORT_RECONNECT_FAILED, "Failed to reconnect");
		}
	}

	/**
	 * Resumes an existing session by loading it from storage and connecting to the
	 * transport on the session's secure channel.
	 *
	 * @param sessionId - The ID of the session to resume.
	 * @throws {SessionError} If the session is not found, has expired, or the client
	 * is not in a `DISCONNECTED` state.
	 */
	public async resume(sessionId: string): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot resume when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		try {
			const session = await this.sessionstore.get(sessionId);
			if (!session) throw new SessionError(ErrorCode.SESSION_NOT_FOUND, "Session not found or expired");
			this.keymanager.validatePeerKey(session.theirPublicKey);

			this.session = session;
			await this.transport.connect();
			await this.transport.subscribe(session.channel);
			this.state = ClientState.CONNECTED;
			this.emit("connected");
		} catch (error) {
			this.state = ClientState.DISCONNECTED;
			this.session = null;
			throw error;
		}
	}

	/**
	 * Disconnects the client, clears the active session from memory and persistent
	 * storage, and cleans up the transport channel. Emits a 'disconnected' event.
	 */
	public async disconnect(): Promise<void> {
		if (!this.session) return;
		const session = this.session; // Capture reference before setting to null
		this.session = null;
		this.state = ClientState.DISCONNECTED;
		await this.transport.disconnect();
		await this.transport.clear(session.channel);
		await this.sessionstore.delete(session.id);
		this.emit("disconnected");
	}

	/**
	 * Handles a decrypted, incoming protocol message.
	 * Subclasses must implement this method to define their message handling logic.
	 *
	 * @param message - The decrypted protocol message.
	 */
	protected abstract handleMessage(message: ProtocolMessage): void;

	/**
	 * Encrypts and sends a protocol message to a specified channel.
	 * Automatically checks for session expiry before sending.
	 *
	 * @param channel - The communication channel to publish the message on.
	 * @param message - The protocol message to send.
	 * @throws {SessionError} If the client session is not initialized or is expired.
	 * @throws {TransportError} If the message fails to send due to a transport issue.
	 */
	protected async sendMessage(channel: string, message: ProtocolMessage): Promise<void> {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send message: session is not initialized.");
		await this.checkSessionExpiry();
		const plaintext = JSON.stringify(message);
		const encrypted = await this.keymanager.encrypt(plaintext, this.session.theirPublicKey);
		const ok = await this.transport.publish(channel, encrypted);
		if (!ok) throw new TransportError(ErrorCode.TRANSPORT_DISCONNECTED, "Message could not be sent because the transport is disconnected.");
	}

	/**
	 * Checks if the current session is expired. If it is, triggers a disconnect.
	 * @throws {SessionError} if the session is expired.
	 */
	private async checkSessionExpiry(): Promise<void> {
		if (!this.session) return;
		if (this.session.expiresAt < Date.now()) {
			await this.disconnect();
			throw new SessionError(ErrorCode.SESSION_EXPIRED, "Session expired");
		}
	}

	/**
	 * Decrypts an incoming message payload.
	 *
	 * @param encrypted - The base64-encoded encrypted payload.
	 * @returns The parsed `ProtocolMessage`, or `null` if decryption fails.
	 * On failure, it emits a `CryptoError`.
	 */
	private async decryptMessage(encrypted: string): Promise<ProtocolMessage | null> {
		if (!this.session?.keyPair.privateKey) return null;
		try {
			const decrypted = await this.keymanager.decrypt(encrypted, this.session.keyPair.privateKey);
			return JSON.parse(decrypted);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.emit("error", new CryptoError(ErrorCode.DECRYPTION_FAILED, `Decryption failed: ${msg}`));
			return null;
		}
	}
}
