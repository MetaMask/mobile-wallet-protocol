import type { TestResults } from "./types.js";

/**
 * Interface for uploading test results to various destinations.
 * This abstraction allows swapping implementations (local file system, S3, etc.)
 * without changing the core logic.
 */
export interface ResultUploader {
	/**
	 * Upload test results to the destination.
	 * @param results - Test results to upload
	 * @param options - Upload options (e.g., path, key, etc.)
	 * @returns Path or identifier where results were uploaded
	 */
	upload(results: TestResults, options?: UploadOptions): Promise<string>;
}

/**
 * Options for uploading results.
 */
export interface UploadOptions {
	/**
	 * Path or key for the results.
	 * For local file system: file path
	 * For S3: object key
	 */
	path?: string;
}

/**
 * Local file system uploader.
 * Writes results to a local file path.
 */
export class LocalFileUploader implements ResultUploader {
	async upload(results: TestResults, options?: UploadOptions): Promise<string> {
		if (!options?.path) {
			throw new Error("LocalFileUploader requires a path option");
		}

		const { writeResults } = await import("./writer.js");
		writeResults(options.path, results);
		return options.path;
	}
}

/**
 * Get the appropriate uploader based on environment.
 * Currently only supports local file system.
 * Future: can detect AWS environment and return S3Uploader.
 */
export function getUploader(): ResultUploader {
	// Check if we're running in AWS (future implementation)
	// For now, always use local file system
	return new LocalFileUploader();
}
