/**
 * A session request is a message sent by the dApp to the wallet to initiate a session.
 */
export type SessionRequest = {
	id: string;
	publicKeyB64: string;
};
