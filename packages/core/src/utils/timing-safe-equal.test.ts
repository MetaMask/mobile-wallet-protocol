import * as t from "vitest";
import { timingSafeEqual } from "./timing-safe-equal";

t.describe("timingSafeEqual", () => {
	t.test("returns true for identical strings", () => {
		t.expect(timingSafeEqual("123456", "123456")).toBe(true);
	});

	t.test("returns true for empty strings", () => {
		t.expect(timingSafeEqual("", "")).toBe(true);
	});

	t.test("returns false for different strings of same length", () => {
		t.expect(timingSafeEqual("123456", "654321")).toBe(false);
	});

	t.test("returns false when only last character differs", () => {
		t.expect(timingSafeEqual("123456", "123457")).toBe(false);
	});

	t.test("returns false for different lengths", () => {
		t.expect(timingSafeEqual("12345", "123456")).toBe(false);
		t.expect(timingSafeEqual("123456", "12345")).toBe(false);
	});

	t.test("returns false when one string is empty", () => {
		t.expect(timingSafeEqual("", "123456")).toBe(false);
		t.expect(timingSafeEqual("123456", "")).toBe(false);
	});
});
