import type { ClientState, HandshakeOfferPayload, IKeyManager, ISessionStore, ITransport, ProtocolMessage, Session } from "@metamask/mobile-wallet-protocol-core";
import type { OtpRequiredPayload } from "../client";

/**
 * Context object that provides controlled access to client dependencies for connection handlers.
 * This interface defines exactly what handlers need to operate, ensuring proper encapsulation
 * of the client's internal state and methods.
 */
export interface IConnectionHandlerContext {
	// State Accessors & Mutators
	session: Session | null;
	state: ClientState;

	// Core Dependencies
	readonly transport: ITransport;
	readonly sessionstore: ISessionStore;
	readonly keymanager: IKeyManager;

	// Events
	emit(event: "otp_required", payload: OtpRequiredPayload): void;
	emit(event: "connected"): void;
	once(event: "handshake_offer_received", listener: (p: HandshakeOfferPayload) => void): void;
	off(event: "handshake_offer_received", listener: (p: HandshakeOfferPayload) => void): void;

	// Actions
	sendMessage(channel: string, message: ProtocolMessage): Promise<void>;
}
