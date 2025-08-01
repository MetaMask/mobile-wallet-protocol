/**
 * The connection mode to use for establishing a session.
 * 'trusted': A streamlined flow for same-device or trusted contexts that bypasses OTP.
 * 'untrusted': The high-security flow requiring user verification via OTP.
 */
export type ConnectionMode = "trusted" | "untrusted";
