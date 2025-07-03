import EventEmitter from "eventemitter3";
import type { IKeyManager } from "./domain/key-manager";
import type { ProtocolMessage } from "./domain/protocol-message";
import type { Session } from "./domain/session";
import type { ISessionStore } from "./domain/session-store";
import type { ITransport } from "./domain/transport";

/**
 * Provides the foundational tools for communication: a transport, a key manager, session management
 * and methods for sending/receiving encrypted messages. It does not manage
 * the handshake state itself, leaving that to the concrete implementations.
 */
export abstract class BaseClient extends EventEmitter {
	protected transport: ITransport;
	protected keymanager: IKeyManager;
	protected sessionstore: ISessionStore;
	protected session: Session | null = null;

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

	public async disconnect(): Promise<void> {
		if (!this.session) return;
		await this.transport.disconnect();
		await this.transport.clear(this.session.channel);
		await this.sessionstore.delete(this.session.id);
		this.session = null;
		this.emit("disconnected");
	}

	protected abstract handleMessage(message: ProtocolMessage): void;

	protected async sendMessage(message: ProtocolMessage): Promise<void> {
		if (!this.session) throw new Error("Cannot send message: session is not initialized.");
		const plaintext = JSON.stringify(message);
		const encrypted = await this.keymanager.encrypt(plaintext, this.session.theirPublicKey);
		await this.transport.publish(this.session.channel, encrypted);
	}

	private async decryptMessage(encrypted: string): Promise<ProtocolMessage | null> {
		if (!this.session?.keyPair.privateKey) return null;
		try {
			const decrypted = await this.keymanager.decrypt(encrypted, this.session.keyPair.privateKey);
			return JSON.parse(decrypted);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.emit("error", new Error(`Decryption failed: ${msg}`));
			return null;
		}
	}
}
