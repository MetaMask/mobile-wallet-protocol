import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/**/*.test.ts"],
	},
	resolve: {
		alias: {
			"@metamask/mobile-wallet-protocol-core": path.resolve(__dirname, "./packages/core/src"),
		},
	},
});
