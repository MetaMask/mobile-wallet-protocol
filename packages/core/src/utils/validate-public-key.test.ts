import * as t from "vitest";
import { CryptoError, ErrorCode } from "../domain/errors";
import { validateSecp256k1PublicKey } from "./validate-public-key";

t.describe("validateSecp256k1PublicKey", () => {
	t.test("should accept a valid compressed key with 0x02 prefix", () => {
		const key = new Uint8Array(33);
		key[0] = 0x02;
		t.expect(() => validateSecp256k1PublicKey(key)).not.toThrow();
	});

	t.test("should accept a valid compressed key with 0x03 prefix", () => {
		const key = new Uint8Array(33);
		key[0] = 0x03;
		t.expect(() => validateSecp256k1PublicKey(key)).not.toThrow();
	});

	t.test("should reject a key that is too short", () => {
		const key = new Uint8Array(32);
		key[0] = 0x02;
		try {
			validateSecp256k1PublicKey(key);
			t.expect.unreachable("should have thrown");
		} catch (e) {
			t.expect(e).toBeInstanceOf(CryptoError);
			t.expect((e as CryptoError).code).toBe(ErrorCode.INVALID_KEY);
		}
	});

	t.test("should reject a key that is too long", () => {
		const key = new Uint8Array(65);
		key[0] = 0x04;
		try {
			validateSecp256k1PublicKey(key);
			t.expect.unreachable("should have thrown");
		} catch (e) {
			t.expect(e).toBeInstanceOf(CryptoError);
			t.expect((e as CryptoError).code).toBe(ErrorCode.INVALID_KEY);
		}
	});

	t.test("should reject a key with an invalid prefix", () => {
		const key = new Uint8Array(33);
		key[0] = 0x04;
		try {
			validateSecp256k1PublicKey(key);
			t.expect.unreachable("should have thrown");
		} catch (e) {
			t.expect(e).toBeInstanceOf(CryptoError);
			t.expect((e as CryptoError).code).toBe(ErrorCode.INVALID_KEY);
		}
	});

	t.test("should reject an empty key", () => {
		const key = new Uint8Array(0);
		try {
			validateSecp256k1PublicKey(key);
			t.expect.unreachable("should have thrown");
		} catch (e) {
			t.expect(e).toBeInstanceOf(CryptoError);
			t.expect((e as CryptoError).code).toBe(ErrorCode.INVALID_KEY);
		}
	});
});
