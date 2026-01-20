import { runAsyncDelivery } from "./async-delivery.js";
import { runConnectionStorm } from "./connection-storm.js";
import { runRealisticSession } from "./realistic-session.js";
import { runSteadyMessaging } from "./steady-messaging.js";
import { runSteadyState } from "./steady-state.js";
import type {
	AsyncDeliveryOptions,
	AsyncDeliveryResult,
	RealisticSessionOptions,
	RealisticSessionResult,
	ScenarioName,
	ScenarioOptions,
	ScenarioResult,
	SteadyMessagingOptions,
	SteadyMessagingResult,
} from "./types.js";

export type {
	AsyncDeliveryOptions,
	AsyncDeliveryResult,
	RealisticSessionOptions,
	RealisticSessionResult,
	ScenarioName,
	ScenarioOptions,
	ScenarioResult,
	SteadyMessagingOptions,
	SteadyMessagingResult,
};

/**
 * Run a scenario by name.
 * This is the main entry point for executing load test scenarios.
 */
export async function runScenario(
	name: ScenarioName,
	options: ScenarioOptions | RealisticSessionOptions | AsyncDeliveryOptions | SteadyMessagingOptions,
): Promise<ScenarioResult | RealisticSessionResult | AsyncDeliveryResult | SteadyMessagingResult> {
	switch (name) {
		case "connection-storm":
			return runConnectionStorm(options);
		case "steady-state":
			return runSteadyState(options);
		case "realistic-session":
			return runRealisticSession(options as RealisticSessionOptions);
		case "async-delivery":
			return runAsyncDelivery(options as AsyncDeliveryOptions);
		case "steady-messaging":
			return runSteadyMessaging(options as SteadyMessagingOptions);
		default:
			throw new Error(`Unknown scenario: ${name as string}`);
	}
}

/**
 * Check if a string is a valid scenario name.
 */
export function isValidScenarioName(name: string): name is ScenarioName {
	return (
		name === "connection-storm" ||
		name === "steady-state" ||
		name === "realistic-session" ||
		name === "async-delivery" ||
		name === "steady-messaging"
	);
}
