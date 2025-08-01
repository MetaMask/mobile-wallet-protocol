import type { Session, SessionRequest } from "@metamask/mobile-wallet-protocol-core";

/**
 * Interface for dApp connection handlers that manage the complete connection flow
 * from initial handshake through session establishment.
 *
 * Each handler is responsible for a specific connection mode and contains all
 * the logic needed to complete that particular flow from the dApp's perspective.
 */
export interface IConnectionHandler {
	/**
	 * Executes the complete connection process for this handler's mode.
	 * This method is fully self-contained and handles everything from transport
	 * setup through session finalization.
	 *
	 * @param session - The session object for this connection (may be a "pending"
	 *   session with temporary values that gets finalized during the process)
	 * @param request - The session request containing connection details and mode
	 * @throws {SessionError} If any step of the connection process fails
	 */
	execute(session: Session, request: SessionRequest): Promise<void>;
}
