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
	/**
	 * An optional, unencrypted message.
	 *
	 * If provided, this will be the first message the wallet processes immediately after
	 * the connection is finalized. This is used to solve the "dApp suspension" issue
	 * on mobile deep linking.
	 */
	initialMessage?: Message;
};
