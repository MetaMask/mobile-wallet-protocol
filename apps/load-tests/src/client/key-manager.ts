import type { IKeyManager, KeyPair } from "@metamask/mobile-wallet-protocol-core";

/**
 * Mock KeyManager for load testing.
 *
 * We mock encryption because the relay server only sees opaque payloads -
 * it doesn't validate or care about ECIES. Real crypto is CPU-intensive
 * and would bottleneck the load generator, not the relay server.
 *
 * This keeps tests high-fidelity from the backend's perspective while
 * being lightweight from the runner's perspective.
 */
export class MockKeyManager implements IKeyManager {
	private static readonly MOCK_PRIVATE_KEY = new Uint8Array(32).fill(0x42);
	private static readonly MOCK_PUBLIC_KEY = new Uint8Array(33).fill(0x43);

	generateKeyPair(): KeyPair {
		return {
			privateKey: MockKeyManager.MOCK_PRIVATE_KEY,
			publicKey: MockKeyManager.MOCK_PUBLIC_KEY,
		};
	}

	validatePeerKey(_key: Uint8Array): void {
		// No-op: load tests don't use real crypto
	}

	async encrypt(plaintext: string, _theirPublicKey: Uint8Array): Promise<string> {
		return Buffer.from(plaintext, "utf8").toString("base64");
	}

	async decrypt(encryptedB64: string, _myPrivateKey: Uint8Array): Promise<string> {
		return Buffer.from(encryptedB64, "base64").toString("utf8");
	}
}
