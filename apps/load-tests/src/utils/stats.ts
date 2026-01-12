/**
 * Connection time statistics for a set of measurements.
 * Note: This measures the time to establish a WebSocket connection,
 * NOT message round-trip latency.
 */
export interface ConnectTimeStats {
	min: number;
	max: number;
	avg: number;
	p50: number;
	p95: number;
	p99: number;
}

/**
 * Calculate connection time statistics from an array of timing measurements.
 * Returns null if the array is empty.
 */
export function calculateConnectTimeStats(times: number[]): ConnectTimeStats | null {
	if (times.length === 0) return null;
	const sorted = [...times].sort((a, b) => a - b);
	return {
		min: Math.round(Math.min(...sorted)),
		max: Math.round(Math.max(...sorted)),
		avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
		p50: Math.round(sorted[Math.floor((sorted.length - 1) * 0.5)] ?? 0),
		p95: Math.round(sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0),
		p99: Math.round(sorted[Math.floor((sorted.length - 1) * 0.99)] ?? 0),
	};
}

