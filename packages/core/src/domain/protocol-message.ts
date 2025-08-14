export type HandshakeOfferPayload = {
	publicKeyB64: string;
	channelId: string;
	otp?: string;
	deadline?: number;
};

export type HandshakeOffer = {
	type: "handshake-offer";
	payload: HandshakeOfferPayload;
};

export type HandshakeAck = {
	type: "handshake-ack";
};

export type Message = {
	type: "message";
	payload: unknown;
};

/**
 * A protocol message is a message that is sent between the dapp and the wallet.
 * It can be a handshake offer, a handshake ack, or a message.
 */
export type ProtocolMessage = HandshakeOffer | HandshakeAck | Message;
