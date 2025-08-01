import type { Session, SessionRequest } from "@metamask/mobile-wallet-protocol-core";

/**
 * Interface for wallet connection handlers that manage the complete connection flow
 * from receiving a session request through session establishment.
 *
 * Each handler is responsible for a specific connection mode and contains all
 * the logic needed to complete that particular flow from the wallet's perspective.
 */
export interface IConnectionHandler {
	/**
	 * Executes the complete connection process for this handler's mode.
	 * This method is fully self-contained and handles everything from transport
	 * setup through session finalization.
	 *
	 * @param session - The session object for this connection (typically a complete
	 *   session with all necessary details)
	 * @param request - The session request containing connection details and mode
	 * @throws {SessionError} If any step of the connection process fails
	 */
	execute(session: Session, request: SessionRequest): Promise<void>;
}
