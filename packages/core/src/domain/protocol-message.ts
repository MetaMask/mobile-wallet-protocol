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

export type ProtocolMessage = HandshakeOffer | HandshakeAck | Message;
