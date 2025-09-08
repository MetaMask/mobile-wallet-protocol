export enum ErrorCode {
	// Session errors
	SESSION_EXPIRED = "SESSION_EXPIRED",
	SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
	SESSION_INVALID_STATE = "SESSION_INVALID_STATE",
	SESSION_SAVE_FAILED = "SESSION_SAVE_FAILED",

	// Transport errors
	TRANSPORT_DISCONNECTED = "TRANSPORT_DISCONNECTED",
	TRANSPORT_PUBLISH_FAILED = "TRANSPORT_PUBLISH_FAILED",
	TRANSPORT_SUBSCRIBE_FAILED = "TRANSPORT_SUBSCRIBE_FAILED",
	TRANSPORT_HISTORY_FAILED = "TRANSPORT_HISTORY_FAILED",
	TRANSPORT_PARSE_FAILED = "TRANSPORT_PARSE_FAILED",
	TRANSPORT_RECONNECT_FAILED = "TRANSPORT_RECONNECT_FAILED",

	// Crypto errors
	DECRYPTION_FAILED = "DECRYPTION_FAILED",

	// Handshake errors
	REQUEST_EXPIRED = "REQUEST_EXPIRED",

	// OTP errors
	OTP_INCORRECT = "OTP_INCORRECT",
	OTP_MAX_ATTEMPTS_REACHED = "OTP_MAX_ATTEMPTS_REACHED",
	OTP_ENTRY_TIMEOUT = "OTP_ENTRY_TIMEOUT",

	// Generic fallback
	UNKNOWN = "UNKNOWN",
}

export class ProtocolError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message?: string,
	) {
		super(message || code);
		this.name = code;
	}
}

export class SessionError extends ProtocolError {}
export class TransportError extends ProtocolError {}
export class CryptoError extends ProtocolError {}
