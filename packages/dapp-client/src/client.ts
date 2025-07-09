import {
	BaseClient,
	type ClientState,
	DEFAULT_SESSION_TTL,
	type IKVStore,
	KeyManager,
	type ProtocolMessage,
	type SessionRequest,
	type SessionStore,
	WebSocketTransport,
} from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";
import { v4 as uuid } from "uuid";
import type { WebSocket } from "ws";

const SESSION_REQUEST_TTL = 60 * 1000; // 60 seconds

export interface DappClientOptions {
	relayUrl: string;
	kvstore: IKVStore;
	sessionstore: SessionStore;
	websocket?: typeof WebSocket;
}

/**
 * Manages the connection from the dApp's perspective, handling session initiation,
 * secure communication, and session management.
 */
export class DappClient extends BaseClient {
	private state: ClientState = "IDLE";
	private connectionTimeoutId: NodeJS.Timeout | null = null;

	static async create(options: DappClientOptions): Promise<DappClient> {
		const transport = await WebSocketTransport.create({
			url: options.relayUrl,
			kvstore: options.kvstore,
			websocket: options.websocket,
		});
		return new DappClient(transport, new KeyManager(), options.sessionstore);
	}

	private constructor(transport: WebSocketTransport, keymanager: KeyManager, sessionstore: SessionStore) {
		super(transport, keymanager, sessionstore);
		this.on("disconnected", () => {
			this.state = "DISCONNECTED";
		});
	}

	/**
	 * Initiates a new session by generating a session ID and key pair,
	 * emitting a 'session-request' event for the wallet to connect.
	 */
	public async connect(): Promise<void> {
		if (this.state !== "IDLE") throw new Error(`Cannot connect when state is ${this.state}`);
		this.state = "CONNECTING";

		const id = uuid();
		const channel = `session:${id}`;
		const keyPair = this.keymanager.generateKeyPair();
		const publicKeyB64 = fromUint8Array(keyPair.publicKey);
		const expiresAt = Date.now() + SESSION_REQUEST_TTL;
		const sessionRequest: SessionRequest = { id, channel, publicKeyB64, expiresAt };

		this.emit("session-request", sessionRequest);

		this.session = {
			id: id,
			channel: channel,
			keyPair: keyPair,
			theirPublicKey: new Uint8Array(0), // Placeholder until handshake completes
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};

		this.connectionTimeoutId = setTimeout(() => {
			if (this.state !== "CONNECTING") return; // Handshake already completed or aborted
			this.emit("session-request-timeout", new Error("Session request timed out"));
			this.disconnect();
		}, SESSION_REQUEST_TTL);

		try {
			await this.transport.connect();
			await this.transport.subscribe(channel);

			// Wait for the wallet to send its public key to complete the handshake
			const theirPublicKey = await new Promise<Uint8Array>((resolve) => {
				this.once("wallet-public-key", (publicKey: string) => {
					resolve(toUint8Array(publicKey));
				});
			});

			if (this.connectionTimeoutId) {
				clearTimeout(this.connectionTimeoutId);
				this.connectionTimeoutId = null;
			}

			this.session.theirPublicKey = theirPublicKey;
			await this.sessionstore.set(this.session);

			this.state = "CONNECTED";
			this.emit("connected");
		} catch (error) {
			if (this.connectionTimeoutId) {
				clearTimeout(this.connectionTimeoutId);
				this.connectionTimeoutId = null;
			}
			this.disconnect();
			throw error;
		}
	}

	public async disconnect(): Promise<void> {
		if (this.connectionTimeoutId) {
			clearTimeout(this.connectionTimeoutId);
			this.connectionTimeoutId = null;
		}
		await super.disconnect();
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
	 * Sends a request to the wallet, ensuring the handshake is complete.
	 * @param payload - The request payload to send
	 */
	public async sendRequest(payload: unknown): Promise<void> {
		if (this.state !== "CONNECTED") throw new Error("Cannot send request: not connected.");
		await this.sendMessage({ type: "dapp-request", payload });
	}

	/**
	 * Processes incoming messages, handling handshake and application-level responses.
	 */
	protected handleMessage(message: ProtocolMessage): void {
		if (this.state === "CONNECTING" && message.type === "wallet-handshake") {
			this.emit("wallet-public-key", message.payload.publicKeyB64);
		}

		if (this.state === "CONNECTED" && message.type === "wallet-response") {
			this.emit("message", message.payload);
		}
	}
}
