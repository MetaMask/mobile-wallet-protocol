import { BaseClient, type IKVStore, KeyManager, type ProtocolMessage, type SessionRequest, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";
import { v4 as uuid } from "uuid";
import type { WebSocket } from "ws";

export interface DappClientOptions {
	relayUrl: string;
	kvstore: IKVStore;
	websocket?: typeof WebSocket; // For Node.js
}

/**
 * The dApp-side client. It initiates a connection by generating a session request,
 * then waits for the wallet to respond to complete the handshake.
 */
export class DappClient extends BaseClient {
	private handshakeCompleted = false;

	static async create(options: DappClientOptions): Promise<DappClient> {
		const transport = await WebSocketTransport.create({
			kvstore: options.kvstore,
			url: options.relayUrl,
			websocket: options.websocket,
		});
		return new DappClient(transport);
	}

	private constructor(transport: WebSocketTransport) {
		super(transport, new KeyManager());
	}

	/**
	 * Starts a new session. This generates a keypair and a session ID,
	 * then emits the session request (which can be used for a QR code to be displayed).
	 */
	public async connect(): Promise<void> {
		if (this.keyPair) return; // Already connecting or connected.

		// 1. Generate session details.
		this.channel = `session:${uuid()}`;
		this.keyPair = this.keymanager.generateKeyPair();
		const publicKeyB64 = fromUint8Array(this.keyPair.publicKey);

		// 2. Create the session request.
		const sessionRequest: SessionRequest = { id: this.channel, publicKeyB64: publicKeyB64 };

		// 3. Signal to consumer the session request.
		this.emit("session-request", sessionRequest);

		// 4. Connect to the relay and wait for the wallet.
		await this.transport.connect();
		await this.transport.subscribe(this.channel);
	}

	/**
	 * Handles all incoming messages from the wallet.
	 */
	protected handleMessage(message: ProtocolMessage): void {
		// During the handshake, we only care about the wallet's response.
		if (!this.handshakeCompleted && message.type === "wallet-handshake") {
			this.theirPublicKey = toUint8Array(message.payload.publicKeyB64);
			this.handshakeCompleted = true;

			// The connection is now fully established.
			this.emit("connected");
			return;
		}

		// After the handshake, forward all other messages to the app.
		if (this.handshakeCompleted && message.type === "wallet-response") {
			this.emit("message", message.payload);
		}
	}

	/**
	 * Sends a request to the connected wallet.
	 */
	public async sendRequest(payload: unknown): Promise<void> {
		if (!this.handshakeCompleted) {
			throw new Error("Cannot send request: handshake not complete.");
		}
		await this.sendMessage({ type: "dapp-request", payload });
	}
}
