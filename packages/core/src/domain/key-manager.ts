import type { KeyPair } from "./key-pair";

/**
 * A key manager is responsible for generating key pairs, encrypting and decrypting messages.
 */
export interface IKeyManager {
	generateKeyPair(): KeyPair;
	encrypt(plaintext: string, theirPublicKey: Uint8Array): Promise<string>;
	decrypt(encryptedB64: string, myPrivateKey: Uint8Array): Promise<string>;
	validatePeerKey(key: Uint8Array): void;
}
