import { ClientState, ErrorCode, type HandshakeOfferPayload, type Session, SessionError, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import { base64ToBytes } from "@metamask/utils";
import { HANDSHAKE_TIMEOUT } from "../client";
import type { IConnectionHandler } from "../domain/connection-handler";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";

/**
 * Handles the trusted connection flow for dApps.
 *
 * This handler implements a simplified connection sequence for same-device
 * or trusted contexts:
 * 1. Connects to transport and subscribes to handshake channel
 * 2. Waits for wallet to send handshake offer
 * 3. Immediately updates session and sends acknowledgment
 * 4. Finalizes connection by persisting session and cleaning up
 *
 * This flow prioritizes user experience over maximum security, making it
 * ideal for same-device scenarios or pre-trusted contexts.
 */
export class TrustedConnectionHandler implements IConnectionHandler {
	private readonly context: IConnectionHandlerContext;

	constructor(context: IConnectionHandlerContext) {
		this.context = context;
	}

	/**
	 * Executes the complete trusted connection flow.
	 * This method is fully self-contained and handles the connection process.
	 */
	public async execute(session: Session, request: SessionRequest): Promise<void> {
		await this.context.transport.connect();
		await this.context.transport.subscribe(request.channel);
		const offer = await this._waitForHandshakeOffer(request.expiresAt);
		const finalSession = this._createFinalSession(session, offer);
		this.context.session = finalSession;
		await this._finalizeConnection(finalSession, request);
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
			if (requestExpiry < Date.now()) {
				return reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Session request expired before wallet could connect"));
			}

			const timeoutDuration = requestExpiry + HANDSHAKE_TIMEOUT - Date.now();

			const timeoutId = setTimeout(() => {
				this.context.off("handshake_offer_received", onOfferReceived);
				reject(new SessionError(ErrorCode.REQUEST_EXPIRED, "Did not receive handshake offer from wallet in time."));
			}, timeoutDuration);

			const onOfferReceived = (payload: HandshakeOfferPayload) => {
				clearTimeout(timeoutId);
				resolve(payload);
			};

			this.context.once("handshake_offer_received", onOfferReceived);
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
			theirPublicKey: base64ToBytes(offer.publicKeyB64),
		};
	}

	/**
	 * Completes the connection by persisting the session, cleaning up the
	 * temporary handshake channel, and transitioning to the `CONNECTED` state.
	 *
	 * @param session - The finalized session object
	 * @param request - The session request object
	 */
	private async _finalizeConnection(session: Session, request: SessionRequest): Promise<void> {
		if (!this.context.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);
		await this.context.sessionstore.set(this.context.session);
		await this.context.transport.subscribe(session.channel);
		await this.context.transport.clear(request.channel);
		this.context.state = ClientState.CONNECTED;
		this.context.emit("connected");
	}
}
