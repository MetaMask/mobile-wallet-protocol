import { CryptoError, ErrorCode } from "../domain/errors";

const COMPRESSED_KEY_LENGTH = 33;
const VALID_PREFIXES = [0x02, 0x03];

/**
 * Validates that the given bytes represent a valid compressed secp256k1 public key.
 * A compressed key is exactly 33 bytes: a prefix byte (0x02 or 0x03) followed by
 * the 32-byte x-coordinate.
 *
 * @throws {CryptoError} with code INVALID_KEY if the key is malformed.
 */
export function validateSecp256k1PublicKey(keyBytes: Uint8Array): void {
	if (keyBytes.length !== COMPRESSED_KEY_LENGTH) {
		throw new CryptoError(ErrorCode.INVALID_KEY, `Invalid public key length: expected ${COMPRESSED_KEY_LENGTH}, got ${keyBytes.length}`);
	}
	if (!VALID_PREFIXES.includes(keyBytes[0])) {
		throw new CryptoError(ErrorCode.INVALID_KEY, `Invalid public key prefix: expected 0x02 or 0x03, got 0x${keyBytes[0].toString(16).padStart(2, "0")}`);
	}
}
