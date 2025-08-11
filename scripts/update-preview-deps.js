import { readFileSync, writeFileSync } from "fs";
import { basename, dirname } from "path";

// The first argument is the preview scope (e.g., '@metamask-previews').
// The rest of the arguments are paths to the package.json files.
const [previewScope, ...packageJsonPaths] = process.argv.slice(2);

if (!previewScope) {
	console.error("Error: Preview scope was not provided.");
	process.exit(1);
}

// First, derive all the new preview package names from the file paths.
// e.g., 'packages/core/package.json' becomes '@metamask-previews/core'
const previewPackageNames = new Set(packageJsonPaths.map((p) => `${previewScope}/${basename(dirname(p))}`));

// Now, iterate through each package.json and update its dependencies.
for (const manifestPath of packageJsonPaths) {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	let wasModified = false;

	// Check dependencies, devDependencies, and peerDependencies
	for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
		if (!manifest[depType]) continue;

		for (const depName in manifest[depType]) {
			// Skip if not a @metamask package
			if (!depName.startsWith("@metamask/")) continue;

			// Extract the package name after @metamask/
			const packageNameAfterScope = depName.split("/")[1];
			// Remove 'mobile-wallet-protocol-' prefix to match the renamed packages
			const simplifiedName = packageNameAfterScope.replace("mobile-wallet-protocol-", "");
			const newDepName = `${previewScope}/${simplifiedName}`;

			// If this dependency is one of our internal packages, we need to rename it.
			if (previewPackageNames.has(newDepName)) {
				const version = manifest[depType][depName];
				delete manifest[depType][depName];
				manifest[depType][newDepName] = version;
				wasModified = true;
			}
		}
	}

	// Only write the file back if we actually changed something.
	if (wasModified) {
		writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
	}
}

console.log("Successfully updated internal dependencies.");
