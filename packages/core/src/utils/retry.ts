import { ErrorCode, ProtocolError } from "../domain/errors";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RetryOptions = {
	/** The number of attempts to make. */
	attempts: number;
	/** The base delay in milliseconds. */
	delay: number;
};

/**
 * Retries a function until it succeeds or the maximum number of attempts is reached.
 *
 * @param fn - The function to retry.
 * @param options - The retry options.
 * @returns The result of the function.
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
	for (let attempt = 0; attempt < options.attempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (attempt === options.attempts - 1) {
				throw error; // Re-throw last error
			}
			const backoff = options.delay * 2 ** attempt;
			await delay(backoff);
		}
	}
	// This line is unreachable but satisfies TypeScript
	throw new ProtocolError(ErrorCode.UNKNOWN, "Retry logic failed unexpectedly.");
}
