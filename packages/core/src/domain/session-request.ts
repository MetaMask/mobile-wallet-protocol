/**
 * A session request is a message sent by the dApp to the wallet to initiate a session.
 * It contains the session ID and the public key of the dApp.
 */
export type SessionRequest = {
	id: string;
	publicKeyB64: string;
};
