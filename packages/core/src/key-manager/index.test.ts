import * as t from "vitest";
import { KeyManager } from "./index";

t.describe("KeyManager", () => {
	let keyManager: KeyManager;

	t.beforeEach(() => {
		keyManager = new KeyManager();
	});

	t.test("should generate a valid key pair", () => {
		const keyPair = keyManager.generateKeyPair();

		t.expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
		t.expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
		t.expect(keyPair.privateKey.length).toBe(32);
		t.expect(keyPair.publicKey.length).toBe(33); // Compressed public key
	});

	t.test("should encrypt and decrypt a message successfully", async () => {
		const keyPair1 = keyManager.generateKeyPair();
		const originalMessage = "This is a secret message.";
		const encryptedMessage = await keyManager.encrypt(originalMessage, keyPair1.publicKey);
		const decryptedMessage = await keyManager.decrypt(encryptedMessage, keyPair1.privateKey);

		t.expect(decryptedMessage).toBe(originalMessage);
	});

	t.test("should fail to decrypt with the wrong private key", async () => {
		const keyPair1 = keyManager.generateKeyPair();
		const keyPair2 = keyManager.generateKeyPair();
		const originalMessage = "This is another secret message.";
		const encryptedMessage = await keyManager.encrypt(originalMessage, keyPair1.publicKey);

		await t.expect(keyManager.decrypt(encryptedMessage, keyPair2.privateKey)).rejects.toThrow();
	});
});
