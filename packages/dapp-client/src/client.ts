import {
	BaseClient,
	ClientState,
	DEFAULT_SESSION_TTL,
	ErrorCode,
	type ISessionStore,
	type ITransport,
	KeyManager,
	type ProtocolMessage,
	type Session,
	SessionError,
	type SessionRequest,
} from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";
import { v4 as uuid } from "uuid";

const SESSION_REQUEST_TTL = 60 * 1000; // 60 seconds

export interface DappClientOptions {
	transport: ITransport;
	sessionstore: ISessionStore;
}

/**
 * Manages the connection from the dApp's perspective, handling session initiation,
 * secure communication, and session management.
 */
export class DappClient extends BaseClient {
	private timeoutId: NodeJS.Timeout | null = null;
	private timeoutMs = SESSION_REQUEST_TTL;

	constructor(options: DappClientOptions) {
		super(options.transport, new KeyManager(), options.sessionstore);
	}

	/**
	 * Initiates a new session by generating a session ID and key pair,
	 * emitting a 'session-request' event for the wallet to connect.
	 */
	public async connect(): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		const { session, request } = this.createPendingSessionAndRequest();
		this.session = session;
		this.emit("session-request", request);

		try {
			await this.transport.connect();
			await this.transport.subscribe(session.channel);
			const theirPublicKey = await this.waitForWalletPublicKey();
			session.theirPublicKey = theirPublicKey;
			await this.sessionstore.set(session);
			this.state = ClientState.CONNECTED;
			this.emit("connected");
		} catch (error) {
			await this.disconnect();
			throw error;
		}
	}

	/**
	 * Disconnects.
	 */
	public async disconnect(): Promise<void> {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		await super.disconnect();
	}

	/**
	 * Sends a request to the wallet, ensuring the handshake is complete.
	 * @param payload - The request payload to send
	 */
	public async sendRequest(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send request: not connected.");
		await this.sendMessage({ type: "dapp-request", payload });
	}

	/**
	 * Processes incoming messages, handling handshake and application-level responses.
	 */
	protected handleMessage(message: ProtocolMessage): void {
		if (this.state === ClientState.CONNECTING && message.type === "wallet-handshake") {
			this.emit("wallet-public-key", message.payload.publicKeyB64);
		}

		if (this.state === ClientState.CONNECTED && message.type === "wallet-response") {
			this.emit("message", message.payload);
		}
	}

	/**
	 * Creates a pending session and request.
	 * @returns The session and request.
	 */
	private createPendingSessionAndRequest(): { session: Session; request: SessionRequest } {
		const id = uuid();
		const channel = `session:${id}`;
		const keyPair = this.keymanager.generateKeyPair();

		const session: Session = {
			id,
			channel,
			keyPair,
			theirPublicKey: new Uint8Array(0), // Placeholder until handshake completes
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};

		const request: SessionRequest = {
			id,
			channel,
			publicKeyB64: fromUint8Array(keyPair.publicKey),
			expiresAt: Date.now() + this.timeoutMs,
		};

		return { session, request };
	}

	/**
	 * Waits for the wallet's public key to be received.
	 * @returns The wallet's public key.
	 */
	private waitForWalletPublicKey(): Promise<Uint8Array> {
		return new Promise((resolve, reject) => {
			const timeoutError = new Error("Session request timed out");

			this.timeoutId = setTimeout(() => {
				this.timeoutId = null;
				reject(timeoutError);
			}, this.timeoutMs);

			this.once("wallet-public-key", (publicKey: string) => {
				if (this.timeoutId) {
					clearTimeout(this.timeoutId);
					this.timeoutId = null;
				}
				resolve(toUint8Array(publicKey));
			});
		});
	}
}
