import * as t from "vitest";
import {
	decrypt,
	deriveSharedSecret,
	encrypt,
	generateKeyPair
} from "./index";

t.describe("Crypto functions", () => {
	t.it("should generate a valid P-256 key pair", () => {
		const keyPair = generateKeyPair();

		t.expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
		t.expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
		t.expect(keyPair.privateKey.length).toBe(32); // P-256 private key is 32 bytes
		t.expect(keyPair.publicKey.length).toBe(33); // Compressed P-256 public key is 33 bytes
	});

	t.it("should generate different key pairs on each call", () => {
		const keyPair1 = generateKeyPair();
		const keyPair2 = generateKeyPair();

		t.expect(keyPair1.privateKey).not.toEqual(keyPair2.privateKey);
		t.expect(keyPair1.publicKey).not.toEqual(keyPair2.publicKey);
	});

	t.it("should derive the same shared secret for both parties", () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();

		// Alice derives shared secret using her private key and Bob's public key
		const aliceSharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

		// Bob derives shared secret using his private key and Alice's public key
		const bobSharedSecret = deriveSharedSecret(bob.privateKey, alice.publicKey);

		t.expect(aliceSharedSecret).toEqual(bobSharedSecret);
		t.expect(aliceSharedSecret).toBeInstanceOf(Uint8Array);
		t.expect(aliceSharedSecret.length).toBe(32); // SHA-256 produces 32 bytes
	});

	t.it("should derive different shared secrets for different key pairs", () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const charlie = generateKeyPair();

		const aliceBobSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);
		const aliceCharlieSecret = deriveSharedSecret(alice.privateKey, charlie.publicKey);

		t.expect(aliceBobSecret).not.toEqual(aliceCharlieSecret);
	});

	t.it("should encrypt and decrypt a message successfully", async () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

		const plaintext = "Hello, this is a secret message!";

		const encrypted = await encrypt(plaintext, sharedSecret);
		t.expect(typeof encrypted).toBe("string");
		t.expect(encrypted.length).toBeGreaterThan(0);

		const decrypted = await decrypt(encrypted, sharedSecret);
		t.expect(decrypted).toBe(plaintext);
	});

	t.it("should produce different ciphertext for the same message", async () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

		const plaintext = "Same message";

		const encrypted1 = await encrypt(plaintext, sharedSecret);
		const encrypted2 = await encrypt(plaintext, sharedSecret);

		// Should be different due to random IV
		t.expect(encrypted1).not.toBe(encrypted2);

		// But both should decrypt to the same plaintext
		const decrypted1 = await decrypt(encrypted1, sharedSecret);
		const decrypted2 = await decrypt(encrypted2, sharedSecret);

		t.expect(decrypted1).toBe(plaintext);
		t.expect(decrypted2).toBe(plaintext);
	});

	t.it("should fail to decrypt with wrong shared secret", async () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const charlie = generateKeyPair();

		const aliceBobSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);
		const aliceCharlieSecret = deriveSharedSecret(alice.privateKey, charlie.publicKey);

		const plaintext = "Secret message";
		const encrypted = await encrypt(plaintext, aliceBobSecret);

		// Should fail to decrypt with wrong shared secret
		await t.expect(decrypt(encrypted, aliceCharlieSecret)).rejects.toThrow();
	});

	t.it("should handle empty string encryption/decryption", async () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

		const plaintext = "";

		const encrypted = await encrypt(plaintext, sharedSecret);
		const decrypted = await decrypt(encrypted, sharedSecret);

		t.expect(decrypted).toBe(plaintext);
	});

	t.it("should handle unicode characters in encryption/decryption", async () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

		const plaintext = "Hello 世界! 🚀 Émojis and ñõn-ASCII";

		const encrypted = await encrypt(plaintext, sharedSecret);
		const decrypted = await decrypt(encrypted, sharedSecret);

		t.expect(decrypted).toBe(plaintext);
	});

	t.it("should handle large messages", async () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

		// Create a large message (10KB)
		const plaintext = "A".repeat(10000);

		const encrypted = await encrypt(plaintext, sharedSecret);
		const decrypted = await decrypt(encrypted, sharedSecret);

		t.expect(decrypted).toBe(plaintext);
		t.expect(decrypted.length).toBe(10000);
	});

	t.it("should fail to decrypt corrupted ciphertext", async () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

		const plaintext = "Test message";
		const encrypted = await encrypt(plaintext, sharedSecret);

		// Corrupt the ciphertext by changing the last character
		const corrupted = encrypted.slice(0, -1) + "X";

		await t.expect(decrypt(corrupted, sharedSecret)).rejects.toThrow();
	});

	t.it("should work in a complete end-to-end scenario", async () => {
		// Simulate Alice and Bob exchange
		const alice = generateKeyPair();
		const bob = generateKeyPair();

		// Both derive the same shared secret
		const aliceSharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);
		const bobSharedSecret = deriveSharedSecret(bob.privateKey, alice.publicKey);

		t.expect(aliceSharedSecret).toEqual(bobSharedSecret);

		// Alice sends encrypted message to Bob
		const aliceMessage = "Hey Bob, this is Alice speaking!";
		const aliceEncrypted = await encrypt(aliceMessage, aliceSharedSecret);

		// Bob decrypts Alice's message
		const bobDecrypted = await decrypt(aliceEncrypted, bobSharedSecret);
		t.expect(bobDecrypted).toBe(aliceMessage);

		// Bob sends encrypted reply to Alice
		const bobMessage = "Hi Alice, Bob here. Message received!";
		const bobEncrypted = await encrypt(bobMessage, bobSharedSecret);

		// Alice decrypts Bob's reply
		const aliceDecrypted = await decrypt(bobEncrypted, aliceSharedSecret);
		t.expect(aliceDecrypted).toBe(bobMessage);
	});

	t.it("should ensure encrypted data looks like base64", async () => {
		const alice = generateKeyPair();
		const bob = generateKeyPair();
		const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);

		const plaintext = "Test message";
		const encrypted = await encrypt(plaintext, sharedSecret);

		// Should be valid base64 (only contains A-Z, a-z, 0-9, +, /, =)
		t.expect(/^[A-Za-z0-9+/=]+$/.test(encrypted)).toBe(true);

		// Should be decodable as base64
		t.expect(() => atob(encrypted)).not.toThrow();
	});
}); 