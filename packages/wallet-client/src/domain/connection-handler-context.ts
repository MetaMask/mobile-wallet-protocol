import type { ClientState, ISessionStore, ITransport, ProtocolMessage, Session } from "@metamask/mobile-wallet-protocol-core";

/**
 * Context object that provides controlled access to wallet client dependencies for connection handlers.
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

	// Events
	emit(event: "display_otp", otp: string, deadline: number): void;
	emit(event: "connected"): void;
	once(event: "handshake_ack_received", listener: () => void): void;
	off(event: "handshake_ack_received", listener: () => void): void;

	// Actions
	sendMessage(channel: string, message: ProtocolMessage): Promise<void>;
	handleMessage(message: ProtocolMessage): void;
}
