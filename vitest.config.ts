import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
		coverage: {
			include: ["packages/**/*.ts"],
		},
	},
	resolve: {
		alias: {
			"@metamask/mobile-wallet-protocol-core": path.resolve(__dirname, "./packages/core/src"),
			"@metamask/mobile-wallet-protocol-dapp-client": path.resolve(__dirname, "./packages/dapp-client/src"),
			"@metamask/mobile-wallet-protocol-wallet-client": path.resolve(__dirname, "./packages/wallet-client/src"),
		},
	},
});
