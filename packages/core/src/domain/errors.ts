export enum ErrorCode {
	// Session errors
	SESSION_EXPIRED = "SESSION_EXPIRED",
	SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
	SESSION_INVALID_STATE = "SESSION_INVALID_STATE",
	SESSION_SAVE_FAILED = "SESSION_SAVE_FAILED",

	// Transport/Connection errors
	TRANSPORT_DISCONNECTED = "TRANSPORT_DISCONNECTED",
	TRANSPORT_PUBLISH_FAILED = "TRANSPORT_PUBLISH_FAILED",
	TRANSPORT_SUBSCRIBE_FAILED = "TRANSPORT_SUBSCRIBE_FAILED",
	TRANSPORT_HISTORY_FAILED = "TRANSPORT_HISTORY_FAILED",
	TRANSPORT_PARSE_FAILED = "TRANSPORT_PARSE_FAILED",

	// Crypto/Handshake errors
	DECRYPTION_FAILED = "DECRYPTION_FAILED",
	REQUEST_EXPIRED = "REQUEST_EXPIRED",

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

// Subclasses for grouping (optional but helps with type matching)
export class SessionError extends ProtocolError {}
export class TransportError extends ProtocolError {}
export class CryptoError extends ProtocolError {}
