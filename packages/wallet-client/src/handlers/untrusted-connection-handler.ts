import { ClientState, ErrorCode, type HandshakeOfferPayload, type Message, type Session, SessionError, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import { bytesToBase64 } from "@metamask/utils";
import type { IConnectionHandler } from "../domain/connection-handler";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";

/**
 * Handles the untrusted (high-security) connection flow for wallets.
 *
 * This handler implements the complete OTP-based connection sequence:
 * 1. Connects to transport and subscribes to both handshake and session channels
 * 2. Generates a 6-digit OTP and emits 'display_otp' event for user
 * 3. Sends handshake offer containing OTP and deadline to dApp
 * 4. Waits for dApp acknowledgment within the OTP timeout period
 * 5. Finalizes connection by persisting session and cleaning up
 *
 * This flow provides maximum security by requiring the user to manually verify
 * the connection through a time-limited One-Time Password displayed on the wallet.
 */
export class UntrustedConnectionHandler implements IConnectionHandler {
	private readonly context: IConnectionHandlerContext;
	private readonly otpTimeoutMs = 60 * 1000; // 1 minute

	constructor(context: IConnectionHandlerContext) {
		this.context = context;
	}

	/**
	 * Executes the complete untrusted connection flow.
	 * This method is fully self-contained and handles the entire OTP-based connection process.
	 */
	public async execute(session: Session, request: SessionRequest): Promise<void> {
		await this.context.transport.connect();
		await this.context.transport.subscribe(request.channel); // handshake channel
		await this.context.transport.subscribe(session.channel); // secure channel
		this.context.session = session;
		const { otp, deadline } = this._generateOtpWithDeadline();
		this.context.emit("display_otp", otp, deadline);
		await this._sendHandshakeOffer(request.channel, otp, deadline);
		await this._waitForHandshakeAck(deadline);
		await this._finalizeConnection(request.channel);
		this._processInitialMessage(request.initialMessage);
	}

	/**
	 * Generates a 6-digit OTP and its expiration timestamp.
	 *
	 * @returns An object containing the OTP string and its deadline
	 */
	private _generateOtpWithDeadline(): { otp: string; deadline: number } {
		const otp = Math.floor(100000 + Math.random() * 900000).toString();
		const deadline = Date.now() + this.otpTimeoutMs;
		return { otp, deadline };
	}

	/**
	 * Sends the `handshake-offer` message containing the public key, new channel ID, and OTP.
	 *
	 * @param channel - The handshake channel to publish the offer to
	 * @param options - Options containing OTP and deadline for untrusted connections
	 */
	private async _sendHandshakeOffer(channel: string, otp: string, deadline: number): Promise<void> {
		if (!this.context.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);
		const handshakePayload: HandshakeOfferPayload = {
			publicKeyB64: bytesToBase64(this.context.session.keyPair.publicKey),
			channelId: this.context.session.channel.replace("session:", ""),
			otp,
			deadline,
		};
		await this.context.sendMessage(channel, { type: "handshake-offer", payload: handshakePayload });
	}

	/**
	 * Waits for a `handshake-ack` message from the dApp.
	 *
	 * @param deadline - The timestamp when the acknowledgment must be received
	 * @returns A promise that resolves when the ack is received
	 * @throws {SessionError} If the ack is not received before the deadline
	 */
	private _waitForHandshakeAck(deadline: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeoutDuration = deadline - Date.now();
			if (timeoutDuration <= 0) {
				return reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Handshake timed out before it could begin."));
			}

			const timeoutId = setTimeout(() => {
				this.context.off("handshake_ack_received", onAckReceived);
				reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "DApp did not acknowledge the handshake in time."));
			}, timeoutDuration);

			const onAckReceived = () => {
				clearTimeout(timeoutId);
				resolve();
			};

			this.context.once("handshake_ack_received", onAckReceived);
		});
	}

	/**
	 * Completes the connection by persisting the session, cleaning up the
	 * temporary handshake channel, and transitioning to the `CONNECTED` state.
	 *
	 * @param handshakeChannel - The temporary channel used for the initial handshake
	 */
	private async _finalizeConnection(handshakeChannel: string): Promise<void> {
		if (!this.context.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);
		await this.context.sessionstore.set(this.context.session);
		await this.context.transport.clear(handshakeChannel);
		this.context.state = ClientState.CONNECTED;
		this.context.emit("connected");
	}

	/**
	 * Processes the initial message after the connection is finalized.
	 *
	 * @param message - The initial message to process
	 */
	private async _processInitialMessage(message?: Message): Promise<void> {
		if (!message) return;
		setTimeout(() => this.context.handleMessage(message), 0); // setTimeout used to ensure processing after the connection is finalized
	}
}
