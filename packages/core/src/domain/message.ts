/**
 * The structure of a message before it's encrypted. The entire object
 * will be serialized and encrypted into a single string.
 */
export interface PlaintextMessage {
	id: string;
	timestamp: number;
	payload: unknown;
}