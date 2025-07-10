import {
	BaseClient,
	ClientState,
	DEFAULT_SESSION_TTL,
	type ISessionStore,
	type ITransport,
	KeyManager,
	type ProtocolMessage,
	type Session,
	type SessionRequest,
} from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";

export interface WalletClientOptions {
	transport: ITransport;
	sessionstore: ISessionStore;
}

/**
 * Manages the connection from the wallet's perspective, responding to dApp requests
 * and handling secure communication.
 */
export class WalletClient extends BaseClient {
	constructor(options: WalletClientOptions) {
		super(options.transport, new KeyManager(), options.sessionstore);
	}

	/**
	 * Connects to a dApp using the provided session request, generating a key pair
	 * and completing the handshake.
	 * @param options - Options containing the session request from the dApp
	 */
	public async connect(options: { sessionRequest: SessionRequest }): Promise<void> {
		if (this.state !== ClientState.IDLE) throw new Error(`Cannot connect when state is ${this.state}`);

		const request = options.sessionRequest;
		if (Date.now() > request.expiresAt) throw new Error("Session request expired");

		this.state = ClientState.CONNECTING;
		this.session = this.deriveSession(request);

		try {
			await this.transport.connect();
			await this.transport.subscribe(this.session.channel);
			// Send the wallet's public key to the dApp to complete the handshake
			const publicKeyB64 = fromUint8Array(this.session.keyPair.publicKey);
			await this.sendMessage({ type: "wallet-handshake", payload: { publicKeyB64 } });
			await this.sessionstore.set(this.session);
			this.state = ClientState.CONNECTED;
			this.emit("connected");
		} catch (error) {
			await this.disconnect();
			throw error;
		}
	}

	/**
	 * Sends a response to the dApp, ensuring the handshake is complete.
	 * @param payload - The response payload to send
	 */
	public async sendResponse(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED) throw new Error("Cannot send response: not connected.");
		await this.sendMessage({ type: "wallet-response", payload });
	}

	/**
	 * Processes incoming messages, handling application-level requests from the dApp.
	 */
	protected handleMessage(message: ProtocolMessage): void {
		if (this.state === ClientState.CONNECTED && message.type === "dapp-request") {
			this.emit("message", message.payload);
		}
	}

	/**
	 * Derives a session from a session request.
	 * @param request - The session request from the dApp
	 * @returns The session
	 */
	private deriveSession(request: SessionRequest): Session {
		const { id, channel, publicKeyB64: dappPublicKeyB64 } = request;
		const theirPublicKey = toUint8Array(dappPublicKeyB64);
		const keyPair = this.keymanager.generateKeyPair();

		return {
			id,
			channel,
			keyPair,
			theirPublicKey,
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};
	}
}
