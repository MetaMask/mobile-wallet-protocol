import crypto from "node:crypto";

export function getSessionId(): string {
	return `session-${crypto.randomUUID()}`;
}
