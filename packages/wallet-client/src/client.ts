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

export interface WalletClientOptions {
	transport: ITransport;
	sessionstore: ISessionStore;
}

/**
 * Manages the connection from the wallet's perspective, responding to dApp requests
 * and handling secure communication with an OTP-based handshake.
 */
export class WalletClient extends BaseClient {
	private readonly otpTimeoutMs = 60 * 1000; // 1 minute;

	public override on(event: "display_otp", listener: (otp: string, deadline: number) => void): this;
	public override on(event: "connected" | "disconnected", listener: () => void): this;
	public override on(event: "message", listener: (payload: unknown) => void): this;
	public override on(event: "error", listener: (error: Error) => void): this;
	public override on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	constructor(options: WalletClientOptions) {
		super(options.transport, new KeyManager(), options.sessionstore);
	}

	public async connect(options: { sessionRequest: SessionRequest }): Promise<void> {
		if (this.state !== ClientState.DISCONNECTED) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, `Cannot connect when state is ${this.state}`);
		this.state = ClientState.CONNECTING;

		const request = options.sessionRequest;
		if (Date.now() > request.expiresAt) throw new SessionError(ErrorCode.REQUEST_EXPIRED, "Session request expired");

		try {
			this.session = this.createSession(request);
			await this.transport.connect();
			await this.transport.subscribe(request.channel); // handshake channel
			await this.transport.subscribe(this.session.channel); // secure channel
			await this.performHandshake(request.channel);
			await this.finalizeConnection(request.channel);
		} catch (error) {
			await this.disconnect();
			throw error;
		}
	}

	public async sendResponse(payload: unknown): Promise<void> {
		if (this.state !== ClientState.CONNECTED || !this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE, "Cannot send response: not connected.");
		await this.sendMessage(this.session.channel, { type: "message", payload });
	}

	protected handleMessage(message: ProtocolMessage): void {
		switch (message.type) {
			case "handshake-ack":
				this.emit("handshake-ack-received");
				break;
			case "message":
				if (this.state === ClientState.CONNECTED) {
					this.emit("message", message.payload);
				}
				break;
		}
	}

	private async performHandshake(channel: string): Promise<void> {
		const { otp, deadline } = this.generateOtpWithDeadline();
		this.emit("display_otp", otp, deadline);
		await this.sendHandshakeOffer(channel, otp, deadline);
		await this.waitForHandshakeAck(deadline);
	}

	private async sendHandshakeOffer(channel: string, otp: string, deadline: number): Promise<void> {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);

		const handshakePayload: HandshakeOfferPayload = {
			publicKeyB64: fromUint8Array(this.session.keyPair.publicKey),
			channelId: this.session.channel.replace("session:", ""),
			otp,
			deadline,
		};

		await this.sendMessage(channel, { type: "handshake-offer", payload: handshakePayload });
	}

	private async finalizeConnection(channel: string): Promise<void> {
		if (!this.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);
		await this.sessionstore.set(this.session);
		await this.transport.clear(channel);
		this.state = ClientState.CONNECTED;
		this.emit("connected");
	}

	private createSession(request: SessionRequest): Session {
		return {
			id: request.id,
			channel: `session:${uuid()}`,
			keyPair: this.keymanager.generateKeyPair(),
			theirPublicKey: toUint8Array(request.publicKeyB64),
			expiresAt: Date.now() + DEFAULT_SESSION_TTL,
		};
	}

	private generateOtpWithDeadline(): { otp: string; deadline: number } {
		const otp = Math.floor(100000 + Math.random() * 900000).toString();
		const deadline = Date.now() + this.otpTimeoutMs;
		return { otp, deadline };
	}

	private waitForHandshakeAck(deadline: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeoutDuration = deadline - Date.now();
			if (timeoutDuration <= 0) {
				return reject(new SessionError(ErrorCode.OTP_ENTRY_TIMEOUT, "Handshake timed out before it could begin."));
			}

			const timeoutId = setTimeout(() => {
				this.off("handshake-ack-received", onAckReceived);
				reject(new SessionError(ErrorCode.OTP_ENTRY_TIMEOUT, "DApp did not acknowledge the handshake in time."));
			}, timeoutDuration);

			const onAckReceived = () => {
				clearTimeout(timeoutId);
				resolve();
			};

			this.once("handshake-ack-received", onAckReceived);
		});
	}
}
