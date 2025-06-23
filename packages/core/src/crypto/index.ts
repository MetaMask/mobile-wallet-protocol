// src/domain/crypto.ts

import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha2';
import type { KeyPair } from '../domain/key-pair';

/**
 * Generates a new P-256 key pair.
 * @returns A KeyPair object with hex-encoded public and private keys.
 */
export function generateKeyPair(): KeyPair {
	const privateKey = p256.utils.randomPrivateKey();
	const publicKey = p256.getPublicKey(privateKey);
	return { privateKey, publicKey };
}

/**
 * Derives a shared secret using ECDH and hashes it to create a symmetric key.
 * @param myPrivateKey - Your private key.
 * @param theirPublicKey - The other party's public key.
 * @returns A 32-byte shared secret (Uint8Array), suitable for use as an AES key.
 */
export function deriveSharedSecret(myPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
	const sharedPoint = p256.getSharedSecret(myPrivateKey, theirPublicKey);
	// We use the hash of the shared point to ensure a fixed-length key
	return sha256(sharedPoint.slice(1)); // .slice(1) to remove the 0x04 prefix
}

/**
 * Encrypts a plaintext string using AES-GCM with the shared secret.
 * @param plaintext - The string to encrypt.
 * @param sharedSecret - The 32-byte shared secret.
 * @returns A base64-encoded string containing the IV and the ciphertext.
 */
export async function encrypt(plaintext: string, sharedSecret: Uint8Array): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await crypto.subtle.importKey('raw', new Uint8Array(sharedSecret), 'AES-GCM', false, ['encrypt']);
	const encodedPlaintext = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedPlaintext);
	// Prepend the IV to the ciphertext for use in decryption
	const combined = new Uint8Array(iv.length + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), iv.length);

	// Return as a base64 string for easy transport
	return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

/**
 * Decrypts a base64-encoded ciphertext using AES-GCM.
 * @param encryptedBase64 - The base64-encoded string from the encrypt function.
 * @param sharedSecret - The 32-byte shared secret.
 * @returns The original plaintext string. Throws an error if decryption fails.
 */
export async function decrypt(encryptedBase64: string, sharedSecret: Uint8Array): Promise<string> {
	const combined = new Uint8Array(atob(encryptedBase64).split('').map((char) => char.charCodeAt(0)));
	const iv = combined.slice(0, 12);
	const ciphertext = combined.slice(12);
	const key = await crypto.subtle.importKey('raw', new Uint8Array(sharedSecret), 'AES-GCM', false, ['decrypt']);
	const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

	return new TextDecoder().decode(decrypted);
}