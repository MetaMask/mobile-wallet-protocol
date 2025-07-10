import { DappClient } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import * as t from "vitest";

t.describe("Integration Test", () => {
	t.test("dummy test", () => {
		t.expect(DappClient.prototype.constructor).toBe(DappClient);
		t.expect(WalletClient.prototype.constructor).toBe(WalletClient);
	});
});
