import { decrypt, encrypt, PrivateKey } from "eciesjs";
import type { IKeyManager } from "../domain/key-manager";
import type { KeyPair } from "../domain/key-pair";

/**
 * A key manager is responsible for generating key pairs, encrypting and decrypting messages.
 */
export class KeyManager implements IKeyManager {
	generateKeyPair(): KeyPair {
		const privateKey = new PrivateKey();
		return { privateKey: new Uint8Array(privateKey.secret), publicKey: privateKey.publicKey.toBytes(true) };
	}

	async encrypt(plaintext: string, theirPublicKey: Uint8Array): Promise<string> {
		const plaintextBuffer = Buffer.from(plaintext, "utf8");
		const encryptedBuffer = encrypt(theirPublicKey, plaintextBuffer);
		return encryptedBuffer.toString("base64");
	}

	async decrypt(encryptedB64: string, myPrivateKey: Uint8Array): Promise<string> {
		const encryptedBuffer = Buffer.from(encryptedB64, "base64");
		const decryptedBuffer = await decrypt(myPrivateKey, encryptedBuffer);
		return Buffer.from(decryptedBuffer).toString("utf8");
	}
}
