import EventEmitter from "eventemitter3";
import { ClientState } from "./domain/client-state";
import { CryptoError, ErrorCode, SessionError } from "./domain/errors";
import type { IKeyManager } from "./domain/key-manager";
import type { ProtocolMessage } from "./domain/protocol-message";
import type { Session } from "./domain/session";
import type { ISessionStore } from "./domain/session-store";
import type { ITransport } from "./domain/transport";

/**
 * Provides foundational communication tools: a transport, key manager, session management,
 * and methods for sending/receiving encrypted messages.
 */
export abstract class BaseClient extends EventEmitter {
	protected transport: ITransport;
	protected keymanager: IKeyManager;
	protected sessionstore: ISessionStore;
	protected session: Session | null = null;
	protected state: ClientState = ClientState.DISCONNECTED;

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

	/**
	 * Resumes an existing session using the provided session ID,
	 * reconnecting to the transport and channel.
	 * @param sessionId - The ID of the session to resume
	 * @throws Error if the session is not found or has expired
	 */
	public async resume(sessionId: string): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot resume when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		try {
			const session = await this.sessionstore.get(sessionId);
			if (!session) throw new SessionError(ErrorCode.SESSION_NOT_FOUND, "Session not found or expired");

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
	 * Disconnects from the transport and clears the session.
	 */
	public async disconnect(): Promise<void> {
		if (!this.session) return;
		await this.transport.disconnect();
		await this.transport.clear(this.session.channel);
		await this.sessionstore.delete(this.session.id);
		this.session = null;
		this.state = ClientState.DISCONNECTED;
		this.emit("disconnected");
	}

	protected abstract handleMessage(message: ProtocolMessage): void;

	/**
	 * Encrypts and sends a protocol message to a specified channel.
	 */
	protected async sendMessage(channel: string, message: ProtocolMessage): Promise<void> {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send message: session is not initialized.");
		await this.checkSessionExpiry();
		const plaintext = JSON.stringify(message);
		const encrypted = await this.keymanager.encrypt(plaintext, this.session.theirPublicKey);
		await this.transport.publish(channel, encrypted);
	}

	private async checkSessionExpiry(): Promise<void> {
		if (!this.session) return;
		if (this.session.expiresAt < Date.now()) {
			await this.disconnect();
			throw new SessionError(ErrorCode.SESSION_EXPIRED, "Session expired");
		}
	}

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
