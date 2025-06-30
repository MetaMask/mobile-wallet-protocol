import { EventEmitter } from "node:events";
import type { IKeyManager } from "./domain/key-manager";
import type { KeyPair } from "./domain/key-pair";
import type { ITransport } from "./domain/transport";

// FIXME
export type DecryptedMessage = {
	type: string;
	payload: unknown;
};

/**
 * Provides the foundational tools for communication: a transport, a key manager,
 * and methods for sending/receiving encrypted messages. It does not manage
 * the handshake state itself, leaving that to the concrete implementations.
 */
export abstract class BaseClient extends EventEmitter {
	protected transport: ITransport;
	protected keymanager: IKeyManager;

	protected keyPair: KeyPair | null = null;
	protected theirPublicKey: Uint8Array | null = null;
	protected channel: string | null = null;

	constructor(transport: ITransport, keyManager: IKeyManager) {
		super();
		this.transport = transport;
		this.keymanager = keyManager;

		this.transport.on("error", (error) => this.emit("error", error));
		this.transport.on("disconnected", () => this.disconnect());

		this.transport.on("message", async (payload) => {
			if (!this.keyPair?.privateKey) return;
			const message = await this.decryptMessage(payload.data);
			if (message) this.handleMessage(message);
		});
	}

	public async disconnect(): Promise<void> {
		await this.transport.disconnect();
		this.keyPair = null;
		this.theirPublicKey = null;
		this.channel = null;
		this.emit("disconnected");
	}

	protected abstract handleMessage(message: DecryptedMessage): void;

	protected async sendMessage(message: unknown): Promise<void> {
		if (!this.channel || !this.theirPublicKey) {
			throw new Error("Cannot send message: session is not initialized.");
		}
		const plaintext = JSON.stringify(message);
		const encrypted = await this.keymanager.encrypt(plaintext, this.theirPublicKey);
		await this.transport.publish(this.channel, encrypted);
	}

	private async decryptMessage(data: string): Promise<DecryptedMessage | null> {
		if (!this.keyPair?.privateKey) {
			return null; // This check is for type safety
		}
		try {
			const decrypted = await this.keymanager.decrypt(data, this.keyPair.privateKey);
			return JSON.parse(decrypted);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			this.emit("error", new Error(`Decryption failed: ${msg}`));
			return null;
		}
	}
}
