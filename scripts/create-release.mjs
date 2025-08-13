import { execSync } from "child_process";
import fs from "fs/promises";

const MANIFEST_PATH = new URL("../package.json", import.meta.url);
const TEMP_MANIFEST_PATH = new URL("../package.json.bak", import.meta.url);

async function runRelease() {
	const originalManifestContents = await fs.readFile(MANIFEST_PATH, "utf-8");

	try {
		// Backup the original manifest
		await fs.writeFile(TEMP_MANIFEST_PATH, originalManifestContents);

		// Create a modified manifest for the release tool
		const manifest = JSON.parse(originalManifestContents);
		manifest.workspaces = manifest.workspaces.filter((glob) => !glob.startsWith("apps/"));
		await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

		console.log("Temporarily modified package.json to exclude app workspaces for release tool...");

		// Run the release command
		// Pass through any additional arguments to the script
		const args = process.argv.slice(2).join(" ");
		execSync(`yarn create-release-branch ${args}`, { stdio: "inherit" });
	} catch (error) {
		console.error("\nAn error occurred during the release process. Restoring original package.json.");
		// Re-throw the error so the script exits with a non-zero code
		throw error;
	} finally {
		// Restore the original package.json from backup
		await fs.rename(TEMP_MANIFEST_PATH, MANIFEST_PATH);
		console.log("\nRestored original package.json.");
	}
}

runRelease().catch(() => {
	process.exit(1);
});
