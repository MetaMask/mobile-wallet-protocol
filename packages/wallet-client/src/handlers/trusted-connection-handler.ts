import { ClientState, ErrorCode, type HandshakeOfferPayload, type Session, SessionError, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import { bytesToBase64 } from "@metamask/utils";
import type { IConnectionHandler } from "../domain/connection-handler";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";

/**
 * Handles the trusted connection flow for wallets.
 *
 * This handler implements a simplified connection sequence for same-device
 * or trusted contexts:
 * 1. Connects to transport and subscribes to both handshake and session channels
 * 2. Sends handshake offer without OTP directly to dApp
 * 3. Waits for dApp acknowledgment within timeout period
 * 4. Finalizes connection by persisting session and cleaning up
 *
 * This flow prioritizes user experience over maximum security, making it
 * ideal for same-device scenarios or pre-trusted contexts where the user
 * has already established trust through other means.
 */
export class TrustedConnectionHandler implements IConnectionHandler {
	private readonly context: IConnectionHandlerContext;
	private readonly handshakeTimeoutMs = 60 * 1000; // 1 minute

	constructor(context: IConnectionHandlerContext) {
		this.context = context;
	}

	/**
	 * Executes the complete trusted connection flow.
	 * This method is fully self-contained and handles the connection process.
	 */
	public async execute(session: Session, request: SessionRequest): Promise<void> {
		await this.context.transport.connect();
		await this.context.transport.subscribe(request.channel); // handshake channel
		await this.context.transport.subscribe(session.channel); // secure channel
		this.context.session = session;
		await this._sendHandshakeOffer(request.channel);
		await this._waitForHandshakeAck(Date.now() + this.handshakeTimeoutMs);
		await this._finalizeConnection(request.channel);
	}

	/**
	 * Sends the `handshake-offer` message containing the public key and new channel ID.
	 *
	 * @param channel - The handshake channel to publish the offer to
	 */
	private async _sendHandshakeOffer(channel: string): Promise<void> {
		if (!this.context.session) throw new SessionError(ErrorCode.SESSION_INVALID_STATE);
		const handshakePayload: HandshakeOfferPayload = {
			publicKeyB64: bytesToBase64(this.context.session.keyPair.publicKey),
			channelId: this.context.session.channel.replace("session:", ""),
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
				return reject(new SessionError(ErrorCode.OTP_ENTRY_TIMEOUT, "Handshake timed out before it could begin."));
			}

			const timeoutId = setTimeout(() => {
				this.context.off("handshake_ack_received", onAckReceived);
				reject(new SessionError(ErrorCode.OTP_ENTRY_TIMEOUT, "DApp did not acknowledge the handshake in time."));
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
}
