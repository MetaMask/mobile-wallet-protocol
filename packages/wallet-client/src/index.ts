import { BaseClient, type IKVStore, KeyManager, type ProtocolMessage, type SessionRequest, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";
import type { WebSocket } from "ws";

export interface WalletClientOptions {
	relayUrl: string;
	kvstore: IKVStore;
	websocket?: typeof WebSocket; // For Node.js
}

/**
 * The Wallet-side client. It connects to a dApp session by parsing
 * a session request and responding to complete the handshake.
 */
export class WalletClient extends BaseClient {
	private handshakeCompleted = false;

	static async create(options: WalletClientOptions): Promise<WalletClient> {
		const transport = await WebSocketTransport.create({
			kvstore: options.kvstore,
			url: options.relayUrl,
			websocket: options.websocket,
		});
		return new WalletClient(transport);
	}

	private constructor(transport: WebSocketTransport) {
		super(transport, new KeyManager());
	}

	/**
	 * Connects to a dApp session using a session request object.
	 */
	public async connect(options: { sessionRequest: SessionRequest }): Promise<void> {
		// 1. Parse session details from the session request.
		const { id: sessionId, publicKeyB64: dappPublicKeyB64 } = options.sessionRequest;
		this.channel = sessionId;
		this.theirPublicKey = toUint8Array(dappPublicKeyB64);

		// 2. Generate our own keypair.
		this.keyPair = this.keymanager.generateKeyPair();

		// 3. Connect to the relay server.
		await this.transport.connect();
		await this.transport.subscribe(this.channel);

		// 4. Send our public key to the dApp to complete the handshake.
		const publicKeyB64 = fromUint8Array(this.keyPair.publicKey);
		await this.sendMessage({ type: "wallet-handshake", payload: { publicKeyB64: publicKeyB64 } });

		// 5. The handshake is now complete from the wallet's perspective.
		this.handshakeCompleted = true;
		this.emit("connected");
	}

	/**
	 * Handles all incoming messages from the dApp.
	 */
	protected handleMessage(message: ProtocolMessage): void {
		// The wallet only processes messages after its handshake is complete.
		if (this.handshakeCompleted && message.type === "dapp-request") {
			this.emit("message", message.payload);
		}
	}

	/**
	 * Sends a response to the connected dApp.
	 */
	public async sendResponse(payload: unknown): Promise<void> {
		if (!this.handshakeCompleted) {
			throw new Error("Cannot send response: handshake not complete.");
		}
		await this.sendMessage({ type: "wallet-response", payload });
	}
}
