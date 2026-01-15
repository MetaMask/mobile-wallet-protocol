import { sleep } from "./timing.js";

/**
 * Options for running tasks with pacing.
 */
export interface PacingOptions<T> {
	/** Total number of tasks to run */
	count: number;
	/** Time in seconds to spread task starts over */
	rampUpSec: number;
	/** Function to execute for each task (receives 0-based index) */
	onStart: (index: number) => Promise<T>;
}

/**
 * Run tasks with pacing: starts are spread evenly over rampUpSec.
 *
 * Tasks are started in a fire-and-forget pattern (don't wait for completion
 * before starting the next), then all are awaited at the end.
 *
 * @returns Array of results from all tasks (in order)
 */
export async function runWithPacing<T>(options: PacingOptions<T>): Promise<T[]> {
	const { count, rampUpSec, onStart } = options;
	const delayMs = rampUpSec > 0 ? (rampUpSec * 1000) / count : 0;
	const tasks: Promise<T>[] = [];

	for (let i = 0; i < count; i++) {
		tasks.push(onStart(i));

		// Pace task starts (except for the last one)
		if (i < count - 1 && delayMs > 0) {
			await sleep(delayMs);
		}
	}

	return Promise.all(tasks);
}

/**
 * Calculate the pacing delay in milliseconds.
 */
export function calculatePacingDelay(count: number, rampUpSec: number): number {
	return rampUpSec > 0 ? (rampUpSec * 1000) / count : 0;
}

/**
 * Calculate the target rate (tasks per second).
 */
export function calculatePacingRate(count: number, rampUpSec: number): string {
	const delayMs = calculatePacingDelay(count, rampUpSec);
	return delayMs > 0 ? (1000 / delayMs).toFixed(1) : "max";
}

