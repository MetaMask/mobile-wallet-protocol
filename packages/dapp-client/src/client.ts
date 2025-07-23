import {
	BaseClient,
	ClientState,
	CryptoError,
	DEFAULT_SESSION_TTL,
	ErrorCode,
	type ISessionStore,
	type ITransport,
	KeyManager,
	type ProtocolError,
	type ProtocolMessage,
	type Session,
	SessionError,
	type SessionRequest,
	type WalletHandshakePayload,
} from "@metamask/mobile-wallet-protocol-core";
import { fromUint8Array, toUint8Array } from "js-base64";
import { v4 as uuid } from "uuid";

const SESSION_REQUEST_TTL = 60 * 1000; // 60 seconds
const DEFAULT_PIN_ATTEMPTS = 3;

export type PinRequiredPayload = {
	submit: (pin: string) => Promise<void>;
	cancel: () => void;
	deadline: number;
};

export interface DappClientOptions {
	transport: ITransport;
	sessionstore: ISessionStore;
	pinAttempts?: number;
}

export class DappClient extends BaseClient {
	private readonly pinAttempts: number;

	on(event: "qr_code_display", listener: (qrCodeData: string) => void): this;
	on(event: "pin_required", listener: (payload: PinRequiredPayload) => void): this;
	on(event: "connected", listener: () => void): this;
	on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	constructor(options: DappClientOptions) {
		super(options.transport, new KeyManager(), options.sessionstore);
		this.pinAttempts = options.pinAttempts ?? DEFAULT_PIN_ATTEMPTS;
	}

	public connect(): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);

		this.state = ClientState.CONNECTING;

		return new Promise((resolve, reject) => {
			const _connect = async () => {
				try {
					const { session, request } = this.createPendingSessionAndRequest();
					this.session = session;
					await this.transport.connect();
					await this.transport.subscribe(session.channel);
					this.emit("qr_code_display", JSON.stringify(request));
					const handshake = await this.waitForWalletHandshake();
					await this.handlePinVerification(handshake, reject);
					await this.finalizeConnection(handshake);
					resolve();
				} catch (error) {
					await this.disconnect();
					reject(error);
				}
			};
			_connect().catch(reject);
		});
	}

	private waitForWalletHandshake(): Promise<WalletHandshakePayload> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.off("wallet-handshake-received", resolve);
				reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Wallet did not respond to session request in time."));
			}, SESSION_REQUEST_TTL + 5000);

			this.once("wallet-handshake-received", (handshake: WalletHandshakePayload) => {
				clearTimeout(timeout);
				if (!this.session) return reject(new SessionError(ErrorCode.SESSION_NOT_FOUND, "Session lost before PIN entry."));
				this.session.theirPublicKey = toUint8Array(handshake.publicKeyB64);
				resolve(handshake);
			});
		});
	}

	private handlePinVerification(handshake: WalletHandshakePayload, fail: (reason?: ProtocolError) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			if (Date.now() > handshake.expiresAt) return reject(new SessionError(ErrorCode.PIN_ENTRY_TIMEOUT, "PIN entry deadline has already passed."));

			let attemptsLeft = this.pinAttempts;
			const deadline = handshake.expiresAt;

			const pinEntryTimeout = setTimeout(() => {
				reject(new SessionError(ErrorCode.PIN_ENTRY_TIMEOUT, "PIN not submitted before the deadline."));
			}, deadline - Date.now());

			const cleanup = () => clearTimeout(pinEntryTimeout);

			const submit = async (pin: string) => {
				if (pin !== handshake.pin) {
					attemptsLeft -= 1;
					if (attemptsLeft > 0) {
						throw new CryptoError(ErrorCode.PIN_INCORRECT, `Incorrect PIN. ${attemptsLeft} attempts remaining.`);
					}
					// Use reject for promise flow, use fail for main connect() promise
					reject(new CryptoError(ErrorCode.MAX_PIN_ATTEMPTS_REACHED, "Maximum PIN attempts reached."));
					return;
				}
				cleanup();
				resolve();
			};

			const cancel = () => {
				cleanup();
				// Use fail for the main connect() promise as cancellation is a final state.
				fail(new SessionError(ErrorCode.SESSION_INVALID_STATE, "User cancelled PIN entry."));
			};

			this.emit("pin_required", { submit, cancel, deadline });
		});
	}

	private async finalizeConnection(handshake: WalletHandshakePayload) {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_NOT_FOUND, "Session was lost during PIN verification.");

		const oldchannel = this.session.channel;
		const privatechannel = `private:${handshake.channelId}`;

		await this.transport.subscribe(privatechannel);
		this.session.channel = privatechannel;
		await this.sendMessage({ type: "handshake-complete" });
		await this.transport.clear(oldchannel);
		await this.sessionstore.set(this.session);

		this.state = ClientState.CONNECTED;
		this.emit("connected");
	}

	public async sendRequest(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED) {
			throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send request: not connected.");
		}
		await this.sendMessage({ type: "dapp-request", payload });
	}

	protected async handleMessage(message: ProtocolMessage): Promise<void> {
		if (this.state === ClientState.CONNECTING && message.type === "wallet-handshake") {
			try {
				if (!this.session) throw new Error("Session not initialized for handshake.");
				const decrypted = await this.keymanager.decrypt(message.payload.encrypted, this.session.keyPair.privateKey);
				const handshake = JSON.parse(decrypted) as WalletHandshakePayload;
				this.emit("wallet-handshake-received", handshake);
			} catch (error) {
				this.emit("error", new CryptoError(ErrorCode.DECRYPTION_FAILED, "Failed to decrypt wallet handshake."));
			}
			return;
		}

		if (this.state === ClientState.CONNECTED && message.type === "wallet-response") {
			this.emit("message", message.payload);
		}
	}

	private createPendingSessionAndRequest(): { session: Session; request: SessionRequest } {
		const id = uuid();
		const channel = `handshake:${id}`;
		const keyPair = this.keymanager.generateKeyPair();

		const session: Session = {
			id,
			channel,
			keyPair,
			theirPublicKey: new Uint8Array(0),
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};

		const request: SessionRequest = {
			id,
			channel,
			publicKeyB64: fromUint8Array(keyPair.publicKey),
			expiresAt: Date.now() + SESSION_REQUEST_TTL,
		};

		return { session, request };
	}
}
