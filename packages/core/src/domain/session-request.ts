import type { ConnectionMode } from "./connection-mode";
import type { Message } from "./protocol-message";

/**
 * A session request is a message sent by the dApp to the wallet to initiate a session.
 */
export type SessionRequest = {
	id: string;
	mode: ConnectionMode;
	channel: string;
	publicKeyB64: string;
	expiresAt: number;
	payload?: Message["payload"];
};
