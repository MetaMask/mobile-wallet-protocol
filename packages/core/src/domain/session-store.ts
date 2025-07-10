import type { Session } from "./session";

/**
 * ISessionStore is an interface that defines the methods for storing and retrieving sessions.
 */
export interface ISessionStore {
	set(session: Session): Promise<void>;
	get(id: string): Promise<Session | null>;
	list(): Promise<Session[]>;
	delete(id: string): Promise<void>;
}
