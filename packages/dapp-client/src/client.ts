import {
	BaseClient,
	ClientState,
	DEFAULT_SESSION_TTL,
	ErrorCode,
	type HandshakeOfferPayload,
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

export type OtpRequiredPayload = {
	submit: (otp: string) => Promise<void>;
	cancel: () => void;
	deadline: number;
};

/**
 * Manages the connection from the dApp's perspective, handling session initiation,
 * secure communication, and session management.
 */
export class DappClient extends BaseClient {
	private readonly otpAttempts = 3;
	private timeoutId: NodeJS.Timeout | null = null;

	public override on(event: "session_request", listener: (request: SessionRequest) => void): this;
	public override on(event: "otp_required", listener: (payload: OtpRequiredPayload) => void): this;
	public override on(event: "connected" | "disconnected", listener: () => void): this;
	public override on(event: "message", listener: (payload: unknown) => void): this;
	public override on(event: "error", listener: (error: Error) => void): this;
	public override on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	constructor(options: DappClientOptions) {
		super(options.transport, new KeyManager(), options.sessionstore);
	}

	public async connect(): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		const { pendingSession, request } = this.createPendingSessionAndRequest();
		this.session = pendingSession;
		this.emit("session_request", request);

		try {
			await this.transport.connect();
			await this.transport.subscribe(request.channel);
			const offer = await this.waitForHandshakeOffer(request.expiresAt);
			await this.handleOtpInput(offer);
			await this.updateSessionAndAcknowledge(pendingSession, offer);
			await this.finalizeConnection(request.channel);
		} catch (error) {
			await this.disconnect();
			throw error;
		}
	}

	public async disconnect(): Promise<void> {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		await super.disconnect();
	}

	public async sendRequest(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED || !this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send request: not connected.");
		await this.sendMessage(this.session.channel, { type: "message", payload });
	}

	protected handleMessage(message: ProtocolMessage): void {
		if (this.state === ClientState.CONNECTING && message.type === "handshake-offer") {
			this.emit("handshake-offer-received", message.payload);
		} else if (this.state === ClientState.CONNECTED && message.type === "message") {
			this.emit("message", message.payload);
		}
	}

	private createPendingSessionAndRequest(): { pendingSession: Session; request: SessionRequest } {
		const id = uuid();
		const keyPair = this.keymanager.generateKeyPair();

		const pendingSession = {
			id,
			channel: "", // To be determined by the wallet's handshake offer
			keyPair,
			theirPublicKey: new Uint8Array(0), // Placeholder
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};

		const request: SessionRequest = {
			id,
			channel: `handshake:${id}`,
			publicKeyB64: fromUint8Array(keyPair.publicKey),
			expiresAt: Date.now() + SESSION_REQUEST_TTL,
		};

		return { pendingSession, request };
	}

	private waitForHandshakeOffer(requestExpiry: number): Promise<HandshakeOfferPayload> {
		return new Promise((resolve, reject) => {
			const timeoutDuration = requestExpiry - Date.now();
			if (timeoutDuration <= 0) {
				return reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Session request expired before wallet could connect."));
			}

			this.timeoutId = setTimeout(() => {
				this.off("handshake-offer-received", onOfferReceived);
				reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Did not receive handshake offer from wallet in time."));
			}, timeoutDuration);

			const onOfferReceived = (payload: HandshakeOfferPayload) => {
				if (this.timeoutId) clearTimeout(this.timeoutId);
				resolve(payload);
			};

			this.once("handshake-offer-received", onOfferReceived);
		});
	}

	private handleOtpInput(offer: HandshakeOfferPayload): Promise<void> {
		return new Promise((resolve, reject) => {
			if (Date.now() > offer.deadline) {
				return reject(new SessionError(ErrorCode.OTP_ENTRY_TIMEOUT, "The OTP has already expired."));
			}

			let attempts = 0;
			const submit = async (otp: string): Promise<void> => {
				if (otp !== offer.otp) {
					attempts++;
					if (attempts >= this.otpAttempts) {
						reject(new SessionError(ErrorCode.OTP_MAX_ATTEMPTS_REACHED, "Maximum OTP attempts reached."));
					} else {
						throw new SessionError(ErrorCode.OTP_INCORRECT, `Incorrect OTP. ${this.otpAttempts - attempts} attempts remaining.`);
					}
					return;
				}
				resolve(); // OTP is correct
			};

			const cancel = () => reject(new Error("User cancelled OTP entry."));
			this.emit("otp_required", { submit, cancel, deadline: offer.deadline });
		});
	}

	private async updateSessionAndAcknowledge(pendingSession: Session, offer: HandshakeOfferPayload): Promise<void> {
		this.session = { ...pendingSession, channel: `session:${offer.channelId}`, theirPublicKey: toUint8Array(offer.publicKeyB64) };
		await this.transport.subscribe(this.session.channel);
		await this.sendMessage(this.session.channel, { type: "handshake-ack" });
	}

	private async finalizeConnection(handshakeChannel: string): Promise<void> {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);
		await this.sessionstore.set(this.session);
		await this.transport.clear(handshakeChannel);
		this.state = ClientState.CONNECTED;
		this.emit("connected");
	}
}
