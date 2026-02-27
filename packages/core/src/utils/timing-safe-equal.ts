/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 *
 * Always compares every character regardless of where a mismatch occurs,
 * so the execution time does not leak information about which characters
 * matched. Returns false immediately only when the lengths differ (length
 * is not considered secret for OTP comparison).
 */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}
