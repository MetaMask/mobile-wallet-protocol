import * as t from "vitest";
import { getSessionId } from "./index";

t.it("should return a session ID", () => {
	const sessionId = getSessionId();

	t.expect(sessionId).toBeDefined();
	t.expect(typeof sessionId).toBe("string");
	t.expect(sessionId).toMatch(/^session-/);
});
