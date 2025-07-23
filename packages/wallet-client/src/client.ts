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
	type WalletHandshakePayload,
} from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";
import { v4 as uuid } from "uuid";

// Default time-to-live for a PIN, in milliseconds.
const DEFAULT_PIN_DEADLINE_TTL = 60 * 1000; // 1 minute

/**
 * Generates a random 6-digit PIN.
 */
function generatePin(): string {
	return Math.floor(100000 + Math.random() * 900000).toString();
}

export interface WalletClientOptions {
	transport: ITransport;
	sessionstore: ISessionStore;
	/** The time-to-live for the PIN entry, in milliseconds. Defaults to 1 minute. */
	pinDeadlineTTL?: number;
}

/**
 * Manages the connection from the wallet's perspective, responding to dApp requests
 * and handling secure communication.
 */
export class WalletClient extends BaseClient {
	private readonly pinDeadlineTTL: number;

	/** Fired when the PIN is generated and should be displayed to the user. Includes the deadline. */
	on(event: "display_pin", listener: (pin: string, deadline: number) => void): this;
	/** Fired when the connection is fully established and confirmed by the dApp. */
	on(event: "connected", listener: () => void): this;
	on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	constructor(options: WalletClientOptions) {
		super(options.transport, new KeyManager(), options.sessionstore);
		this.pinDeadlineTTL = options.pinDeadlineTTL ?? DEFAULT_PIN_DEADLINE_TTL;
	}

	/**
	 * Connects to a dApp using the provided session request. This method orchestrates
	 * the entire PIN-based handshake and only resolves when the connection is fully
	 * verified and established.
	 * @param options - Options containing the session request from the dApp
	 */
	public async connect(options: { sessionRequest: SessionRequest }): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) {
			throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);
		}
		const { sessionRequest } = options;
		if (Date.now() > sessionRequest.expiresAt) {
			throw new SessionError(ErrorCode.REQUEST_EXPIRED, "Session request expired");
		}

		this.state = ClientState.CONNECTING;

		try {
			// Step 1: Prepare all necessary data and subscribe to channels.
			const handshakeData = this._prepareHandshake(sessionRequest);
			const { privateChannel, pin, deadline } = handshakeData;
			await this.transport.connect();
			await this.transport.subscribe(this.session!.channel);
			await this.transport.subscribe(privateChannel);

			// Step 2: Publish the encrypted handshake payload.
			await this._publishHandshake(handshakeData);
			this.emit("display_pin", pin, deadline);

			// Step 3: Wait for the dApp's confirmation on the private channel.
			await this._waitForConfirmation();

			// Step 4: Finalize the connection.
			await this._finalizeConnection(privateChannel, sessionRequest.channel);
		} catch (error) {
			// On any error, ensure a full cleanup.
			await this.disconnect();
			throw error;
		}
	}

	/**
	 * Prepares all data needed for the handshake.
	 */
	private _prepareHandshake(request: SessionRequest) {
		this.session = this.deriveSession(request);
		const pin = generatePin();
		const privateChannelId = uuid();
		const deadline = Date.now() + this.pinDeadlineTTL;
		const privateChannel = `private:${privateChannelId}`;

		return { pin, privateChannelId, deadline, privateChannel };
	}

	/**
	 * Encrypts and publishes the handshake payload.
	 */
	private async _publishHandshake(handshakeData: { pin: string; privateChannelId: string; deadline: number }) {
		const { pin, privateChannelId, deadline } = handshakeData;

		if (!this.session) throw new SessionError(ErrorCode.SESSION_NOT_FOUND, "Session not initialized.");

		const payload: WalletHandshakePayload = {
			publicKeyB64: fromUint8Array(this.session.keyPair.publicKey),
			channelId: privateChannelId,
			pin,
			expiresAt: deadline,
		};
		const encryptedPayload = await this.keymanager.encrypt(JSON.stringify(payload), this.session.theirPublicKey);
		await this.sendMessage({ type: "wallet-handshake", payload: { encrypted: encryptedPayload } });
	}

	/**
	 * Waits for the `handshake-complete` message from the dApp.
	 */
	private _waitForConfirmation(): Promise<void> {
		return new Promise((resolve, reject) => {
			const confirmationTimeout = setTimeout(() => {
				this.off("handshake-complete", resolve);
				reject(new SessionError(ErrorCode.PIN_ENTRY_TIMEOUT, "Handshake confirmation not received from dApp in time."));
			}, this.pinDeadlineTTL + 5000); // Allow extra time for network latency.

			this.once("handshake-complete", () => {
				clearTimeout(confirmationTimeout);
				resolve();
			});
		});
	}

	/**
	 * Finalizes the session by switching to the private channel and saving the state.
	 */
	private async _finalizeConnection(privateChannel: string, oldChannel: string) {
		if (!this.session) {
			throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Session was lost during handshake completion.");
		}
		// Unsubscribe from the public channel to clean up resources.
		await this.transport.clear(oldChannel);
		// Update the session to use the new private channel for all future communication.
		this.session.channel = privateChannel;
		// Save the finalized session state.
		await this.sessionstore.set(this.session);
		this.state = ClientState.CONNECTED;
		this.emit("connected");
	}

	public async sendResponse(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED) {
			throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send response: not connected.");
		}
		await this.sendMessage({ type: "wallet-response", payload });
	}

	protected handleMessage(message: ProtocolMessage): void {
		if (message.type === "handshake-complete" && this.state === ClientState.CONNECTING) {
			this.emit("handshake-complete");
			return;
		}

		if (this.state === ClientState.CONNECTED && message.type === "dapp-request") {
			this.emit("message", message.payload);
		}
	}

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
