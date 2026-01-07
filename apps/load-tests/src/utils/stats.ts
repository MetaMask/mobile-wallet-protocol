/**
 * Latency statistics for a set of measurements.
 */
export interface LatencyStats {
	min: number;
	max: number;
	avg: number;
	p95: number;
}

/**
 * Calculate latency statistics from an array of latency measurements.
 * Returns null if the array is empty.
 */
export function calculateLatencyStats(latencies: number[]): LatencyStats | null {
	if (latencies.length === 0) return null;
	const sorted = [...latencies].sort((a, b) => a - b);
	return {
		min: Math.round(Math.min(...sorted)),
		max: Math.round(Math.max(...sorted)),
		avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
		p95: Math.round(sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0),
	};
}

