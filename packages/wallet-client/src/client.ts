import {
	BaseClient,
	type ClientState,
	DEFAULT_SESSION_TTL,
	type IKVStore,
	KeyManager,
	type ProtocolMessage,
	type Session,
	type SessionRequest,
	type SessionStore,
	WebSocketTransport,
} from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";
import type { WebSocket } from "ws";

export interface WalletClientOptions {
	relayUrl: string;
	kvstore: IKVStore;
	sessionstore: SessionStore;
	websocket?: typeof WebSocket;
}

/**
 * Manages the connection from the wallet's perspective, responding to dApp requests
 * and handling secure communication.
 */
export class WalletClient extends BaseClient {
	private state: ClientState = "IDLE";

	static async create(options: WalletClientOptions): Promise<WalletClient> {
		const transport = await WebSocketTransport.create({
			kvstore: options.kvstore,
			url: options.relayUrl,
			websocket: options.websocket,
		});
		return new WalletClient(transport, new KeyManager(), options.sessionstore);
	}

	private constructor(transport: WebSocketTransport, keymanager: KeyManager, sessionstore: SessionStore) {
		super(transport, keymanager, sessionstore);
		this.on("disconnected", () => {
			this.state = "DISCONNECTED";
		});
	}

	/**
	 * Connects to a dApp using the provided session request, generating a key pair
	 * and completing the handshake.
	 * @param options - Options containing the session request from the dApp
	 */
	public async connect(options: { sessionRequest: SessionRequest }): Promise<void> {
		if (this.state !== "IDLE") throw new Error(`Cannot connect when state is ${this.state}`);

		const request = options.sessionRequest;
		if (Date.now() > request.expiresAt) throw new Error("Session request expired");

		this.state = "CONNECTING";
		this.session = this.deriveSession(request);
		await this.sessionstore.set(this.session);
		await this.transport.connect();
		await this.transport.subscribe(this.session.channel);
		// Send the wallet's public key to the dApp to complete the handshake
		const publicKeyB64 = fromUint8Array(this.session.keyPair.publicKey);
		await this.sendMessage({ type: "wallet-handshake", payload: { publicKeyB64 } });
		this.state = "CONNECTED";
		this.emit("connected");
	}

	/**
	 * Resumes an existing session using the provided session ID,
	 * reconnecting to the transport and channel.
	 * @param sessionId - The ID of the session to resume
	 * @throws Error if the session is not found or has expired
	 */
	public async resume(sessionId: string): Promise<void> {
		if (this.state !== "IDLE") throw new Error(`Cannot resume when state is ${this.state}`);
		this.state = "CONNECTING";

		const session = await this.sessionstore.get(sessionId);
		if (!session) throw new Error("Session not found");

		this.session = session;
		await this.transport.connect();
		await this.transport.subscribe(session.channel);
		this.state = "CONNECTED";
		this.emit("connected");
	}

	/**
	 * Sends a response to the dApp, ensuring the handshake is complete.
	 * @param payload - The response payload to send
	 */
	public async sendResponse(payload: unknown): Promise<void> {
		if (this.state !== "CONNECTED") throw new Error("Cannot send response: not connected.");
		await this.sendMessage({ type: "wallet-response", payload });
	}

	/**
	 * Processes incoming messages, handling application-level requests from the dApp.
	 */
	protected handleMessage(message: ProtocolMessage): void {
		if (this.state === "CONNECTED" && message.type === "dapp-request") {
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
