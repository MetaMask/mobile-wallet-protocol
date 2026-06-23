export type HandshakeOfferPayload = {
	publicKeyB64: string;
	channelId: string;
	otp?: string;
	deadline?: number;
	/** When true, the wallet requires an `otp-display-grant` before displaying the OTP. */
	otpDisplayGrantRequired?: true;
};

export type HandshakeOffer = {
	type: "handshake-offer";
	payload: HandshakeOfferPayload;
};

export type HandshakeAck = {
	type: "handshake-ack";
};

export type OtpDisplayGrant = {
	type: "otp-display-grant";
};

export type Message = {
	type: "message";
	payload: unknown;
};

/**
 * A protocol message is a message that is sent between the dapp and the wallet.
 * It can be a handshake offer, a handshake ack, an OTP display grant, or a message.
 */
export type ProtocolMessage = HandshakeOffer | HandshakeAck | OtpDisplayGrant | Message;
