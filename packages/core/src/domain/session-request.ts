/**
 * A session request is a message sent by the dApp to the wallet to initiate a session.
 */
export type SessionRequest = {
	id: string;
	channel: string;
	publicKeyB64: string;
	expiresAt: number;
};
