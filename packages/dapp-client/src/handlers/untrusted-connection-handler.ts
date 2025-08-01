// dapp-client/src/handlers/untrusted-connection-handler.ts
import { ClientState, ErrorCode, type HandshakeOfferPayload, type Session, SessionError, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import { toUint8Array } from "js-base64";
import type { OtpRequiredPayload } from "../client";
import type { IConnectionHandler } from "../domain/connection-handler";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";

/**
 * Handles the untrusted (high-security) connection flow for dApps.
 *
 * This handler implements the complete OTP-based connection sequence:
 * 1. Connects to transport and subscribes to handshake channel
 * 2. Waits for wallet to send handshake offer with OTP
 * 3. Prompts user for OTP verification via 'otp_required' event
 * 4. Updates session with wallet's details and sends acknowledgment
 * 5. Finalizes connection by persisting session and cleaning up
 *
 * This flow provides maximum security by requiring user verification of the
 * connection through a time-limited One-Time Password.
 */
export class UntrustedConnectionHandler implements IConnectionHandler {
	private readonly context: IConnectionHandlerContext;
	private readonly otpAttempts = 3;
	private timeoutId: NodeJS.Timeout | null = null;

	constructor(context: IConnectionHandlerContext) {
		this.context = context;
	}

	/**
	 * Executes the complete untrusted connection flow.
	 * This method is fully self-contained and handles the entire OTP-based connection process.
	 */
	public async execute(session: Session, request: SessionRequest): Promise<void> {
		await this.context.transport.connect();
		await this.context.transport.subscribe(request.channel);
		const offer = await this._waitForHandshakeOffer(request.expiresAt);
		await this._handleOtpInput(offer);
		const finalSession = this._createFinalSession(session, offer);
		this.context.session = finalSession;
		await this._acknowledgeHandshake(finalSession);
		await this._finalizeConnection(request.channel);
	}

	/**
	 * Waits for a `handshake-offer` message from the wallet on the handshake channel.
	 *
	 * @param requestExpiry - The timestamp when the session request expires
	 * @returns A promise that resolves with the `HandshakeOfferPayload`
	 * @throws {SessionError} If the offer is not received before the request expires
	 */
	private _waitForHandshakeOffer(requestExpiry: number): Promise<HandshakeOfferPayload> {
		return new Promise((resolve, reject) => {
			const timeoutDuration = requestExpiry - Date.now();
			if (timeoutDuration <= 0) {
				return reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Session request expired before wallet could connect."));
			}

			this.timeoutId = setTimeout(() => {
				this.context.off("handshake_offer_received", onOfferReceived);
				reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Did not receive handshake offer from wallet in time."));
			}, timeoutDuration);

			const onOfferReceived = (payload: HandshakeOfferPayload) => {
				if (this.timeoutId) clearTimeout(this.timeoutId);
				this.timeoutId = null;
				resolve(payload);
			};

			this.context.once("handshake_offer_received", onOfferReceived);
		});
	}

	/**
	 * Manages the OTP verification step by emitting the `otp_required` event and
	 * waiting for the user to submit the correct OTP.
	 *
	 * @param offer - The handshake offer from the wallet containing the OTP
	 * @throws {SessionError} If the OTP is incorrect after max attempts, the OTP expires,
	 * or the user cancels
	 */
	private _handleOtpInput(offer: HandshakeOfferPayload): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!offer.deadline || !offer.otp) {
				return reject(new SessionError(ErrorCode.UNKNOWN, "Handshake offer is missing OTP details for untrusted connection."));
			}

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
				resolve();
			};

			const cancel = () => reject(new Error("User cancelled OTP entry."));
			this.context.emit("otp_required", { submit, cancel, deadline: offer.deadline } as OtpRequiredPayload);
		});
	}

	/**
	 * Creates the final session object with details from the wallet's offer.
	 *
	 * @param session - The pending session object (with temporary values)
	 * @param offer - The handshake offer payload from the wallet
	 * @returns The complete session object ready for use
	 */
	private _createFinalSession(session: Session, offer: HandshakeOfferPayload): Session {
		return {
			...session,
			channel: `session:${offer.channelId}`,
			theirPublicKey: toUint8Array(offer.publicKeyB64),
		};
	}

	/**
	 * Subscribes to the secure session channel and sends handshake acknowledgment.
	 *
	 * @param session - The finalized session object
	 */
	private async _acknowledgeHandshake(session: Session): Promise<void> {
		await this.context.transport.subscribe(session.channel);
		await this.context.sendMessage(session.channel, { type: "handshake-ack" });
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
}
