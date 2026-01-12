import * as fs from "node:fs";
import * as path from "node:path";
import type { TestResults } from "./types.js";

/**
 * Write test results to a JSON file.
 */
export function writeResults(outputPath: string, results: TestResults): void {
	const dir = path.dirname(outputPath);
	if (dir && !fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
	console.log(`[load-test] Results written to ${outputPath}`);
}

