import { execSync } from "child_process";
import fs from "fs/promises";

const MANIFEST_PATH = new URL("../package.json", import.meta.url);
const TEMP_MANIFEST_PATH = new URL("../package.json.bak", import.meta.url);

async function runRelease() {
	const originalManifestContents = await fs.readFile(MANIFEST_PATH, "utf-8");

	// Backup the original manifest.
	await fs.writeFile(TEMP_MANIFEST_PATH, originalManifestContents);

	try {
		// Create a modified manifest for the release tool
		const manifest = JSON.parse(originalManifestContents);
		manifest.workspaces = manifest.workspaces.filter((glob) => !glob.startsWith("apps/"));
		await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

		console.log("Temporarily modified package.json to exclude app workspaces for release tool...");

		// Run the release command
		// Pass through any additional arguments to the script
		const args = process.argv.slice(2).join(" ");
		execSync(`yarn run create-release-branch ${args}`, { stdio: "inherit" });

		// Read the new version from the modified package.json
		const modifiedManifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf-8"));
		const newVersion = modifiedManifest.version;

		// Read the original package.json from backup
		const originalManifest = JSON.parse(await fs.readFile(TEMP_MANIFEST_PATH, "utf-8"));

		// Update the version in the original manifest
		originalManifest.version = newVersion;

		// Write the updated original manifest back
		await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(originalManifest, null, "\t")}\n`);
		console.log(`\nRestored original package.json and updated version to ${newVersion}`);

		// Run yarn install and lint
		console.log("Running yarn install...");
		execSync("yarn install", { stdio: "inherit" });

		console.log("Running yarn lint:fix...");
		execSync("yarn lint:fix", { stdio: "inherit" });
	} catch (error) {
		console.error("\nAn error occurred during the release process. Reverting changes...");

		// Restore original package.json from backup
		const backupContents = await fs.readFile(TEMP_MANIFEST_PATH, "utf-8");
		await fs.writeFile(MANIFEST_PATH, backupContents);
		console.log("Reverted package.json to its original state.");

		// Re-throw the error so the script exits with a non-zero code
		throw error;
	} finally {
		// Remove the backup file
		await fs.unlink(TEMP_MANIFEST_PATH);
	}
}

runRelease().catch(() => {
	process.exit(1);
});
