/**
 * The connection mode to use for establishing a session.
 * 'trusted': A streamlined flow for same-device or trusted contexts that bypasses OTP.
 * 'untrusted': The high-security flow requiring user verification via OTP.
 */
export const CONNECTION_MODES = ["trusted", "untrusted"] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

export function isValidConnectionMode(value: unknown): value is ConnectionMode {
	return typeof value === "string" && CONNECTION_MODES.includes(value as ConnectionMode);
}
