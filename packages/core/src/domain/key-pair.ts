/**
 * Represents a cryptographic key pair, with keys encoded as Uint8Arrays.
 */
export interface KeyPair {
	publicKey: Uint8Array;
	privateKey: Uint8Array;
}
