import { ClientState, ErrorCode, type HandshakeOfferPayload, type Message, type Session, SessionError, type SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import { bytesToBase64 } from "@metamask/utils";
import type { IConnectionHandler } from "../domain/connection-handler";
import type { IConnectionHandlerContext } from "../domain/connection-handler-context";

/**
 * Handles the trusted connection flow for wallets.
 *
 * This handler implements a simplified connection sequence for same-device
 * or trusted contexts:
 * 1. Connects to transport and subscribes to both handshake and session channels
 * 2. Sends handshake offer without OTP directly to dApp (in a fire-and-forget manner)
 * 3. Finalizes connection by persisting session and cleaning up
 *
 * This flow prioritizes user experience over maximum security, making it
 * ideal for same-device scenarios or pre-trusted contexts where the user
 * has already established trust through other means.
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
		this.context.session = session;
		await this.context.transport.connect();
		await this.context.transport.subscribe(request.channel); // handshake channel
		await this.context.transport.subscribe(session.channel); // secure channel
		await this._sendHandshakeOffer(request.channel);
		await this._finalizeConnection(request.channel);
		this._processInitialMessage(request.initialMessage);
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
	private _processInitialMessage(message?: Message): void {
		if (!message) return;
		setTimeout(() => this.context.handleMessage(message), 0); // setTimeout used to ensure processing after the connection is finalized
	}
}
