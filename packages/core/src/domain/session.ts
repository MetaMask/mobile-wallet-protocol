import type { KeyPair } from "./key-pair";

/**
 * A session is a unique identifier for a connection between two parties.
 * It contains the key pair for the local party, the public key of the remote party,
 * and the expiration time of the session.
 */
export interface Session {
	id: string;
	keyPair: KeyPair;
	theirPublicKey: Uint8Array;
	expiresAt: number;
}
