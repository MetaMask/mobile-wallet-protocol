import { runConnectionStorm } from "./connection-storm.js";
import { runSteadyState } from "./steady-state.js";
import type { ScenarioName, ScenarioOptions, ScenarioResult } from "./types.js";

export type { ScenarioName, ScenarioOptions, ScenarioResult };

/**
 * Run a scenario by name.
 * This is the main entry point for executing load test scenarios.
 */
export async function runScenario(
	name: ScenarioName,
	options: ScenarioOptions,
): Promise<ScenarioResult> {
	switch (name) {
		case "connection-storm":
			return runConnectionStorm(options);
		case "steady-state":
			return runSteadyState(options);
		default:
			throw new Error(`Unknown scenario: ${name as string}`);
	}
}

/**
 * Check if a string is a valid scenario name.
 */
export function isValidScenarioName(name: string): name is ScenarioName {
	return name === "connection-storm" || name === "steady-state";
}

