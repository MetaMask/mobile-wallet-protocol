import { Buffer } from "node:buffer";
import { BaseClient, type DecryptedMessage, KeyManager, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import type { WebSocket } from "ws";

type QrCodeData = {
	sessionId: string;
	publicKey: string; // base64 encoded
};

export interface WalletClientOptions {
	relayUrl: string;
	websocket?: typeof WebSocket; // For Node.js
}

/**
 * The Wallet-side client. It connects to a dApp session by parsing
 * QR code data and responding to complete the handshake.
 */
export class WalletClient extends BaseClient {
	private handshakeCompleted = false;

	constructor(options: WalletClientOptions) {
		super(new WebSocketTransport({ clientId: "wallet-client", url: options.relayUrl, websocket: options.websocket }), new KeyManager());
	}

	/**
	 * Connects to a dApp session using data from a QR code.
	 */
	public async connect(options: { qrCodeData: string }): Promise<void> {
		// 1. Parse session details from the QR code.
		const { sessionId, publicKey: dappPublicKeyB64 } = JSON.parse(options.qrCodeData) as QrCodeData;
		this.channel = sessionId;
		this.theirPublicKey = Buffer.from(dappPublicKeyB64, "base64");

		// 2. Generate our own keypair.
		this.keyPair = this.keymanager.generateKeyPair();

		// 3. Connect to the relay server.
		await this.transport.connect();
		await this.transport.subscribe(this.channel);

		// 4. Send our public key to the dApp to complete the handshake.
		const publicKeyB64 = Buffer.from(this.keyPair.publicKey).toString("base64");
		await this.sendMessage({ type: "wallet-handshake", payload: { publicKey: publicKeyB64 } });

		// 5. The handshake is now complete from the wallet's perspective.
		this.handshakeCompleted = true;
		this.emit("connected");
	}

	/**
	 * Handles all incoming messages from the dApp.
	 */
	protected handleMessage(message: DecryptedMessage): void {
		// The wallet only processes messages after its handshake is complete.
		if (this.handshakeCompleted) {
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
