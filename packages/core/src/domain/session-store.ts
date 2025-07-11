import type { Session } from "./session";

/**
 * Interface for persistent session storage.
 */
export interface ISessionStore {
	/**
	 * Stores a session.
	 * @param session - The session to store
	 * @throws Error if the session is expired
	 */
	set(session: Session): Promise<void>;

	/**
	 * Retrieves a session by ID.
	 * @param id - The session ID
	 * @returns The session if found and not expired, null otherwise
	 */
	get(id: string): Promise<Session | null>;

	/**
	 * Lists all active sessions.
	 * @returns Array of non-expired sessions
	 */
	list(): Promise<Session[]>;

	/**
	 * Deletes a session.
	 * @param id - The session ID to delete
	 */
	delete(id: string): Promise<void>;
}
