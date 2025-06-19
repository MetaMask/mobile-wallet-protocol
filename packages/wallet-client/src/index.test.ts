import * as t from "vitest";
import { WalletClient } from "./index";

t.it("should initialize with a session ID", () => {
	const client = new WalletClient();
	const sessionId = client.getSessionId();

	t.expect(sessionId).toBeDefined();
	t.expect(typeof sessionId).toBe("string");
	t.expect(sessionId).toMatch(/^session-/);
});

t.it("should return the same session ID when called multiple times", () => {
	const client = new WalletClient();
	const sessionId1 = client.getSessionId();
	const sessionId2 = client.getSessionId();

	t.expect(sessionId1).toBe(sessionId2);
});
