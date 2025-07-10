/**
 * Defines the contract for a communication transport.
 * This allows the protocol to be agnostic to the underlying
 * communication mechanism (e.g., WebSocket, Deep Link).
 *
 * It is designed around a simple, channel-based publish/subscribe model.
 */
export interface ITransport {
	/**
	 * Establishes a connection.
	 * Returns a promise that resolves when the connection is established.
	 */
	connect(): Promise<void>;

	/**
	 * Disconnects.
	 * Returns a promise that resolves when the connection is closed.
	 */
	disconnect(): Promise<void>;

	/**
	 * Publishes a message to a specific channel.
	 * @param channel The channel to publish the message to.
	 * @param message The message payload to send.
	 * Returns a promise that resolves when the message is published.
	 */
	publish(channel: string, message: string): Promise<void>;

	/**
	 * Subscribes to a channel to begin receiving messages.
	 * @param channel The channel to subscribe to.
	 * Returns a promise that resolves when the subscription is established.
	 */
	subscribe(channel: string): Promise<void>;

	/**
	 * Listens for incoming events from the transport.
	 * @param event The name of the event to listen for.
	 * @param handler The callback function to execute.
	 */
	on(event: "message", handler: (payload: { channel: string; data: string }) => void): void;
	on(event: "connected" | "disconnected", handler: () => void): void;
	on(event: "error", handler: (error: Error) => void): void;

	/**
	 * Clears the transport for a given channel.
	 * @param channel The channel to clear.
	 */
	clear(channel: string): Promise<void>;
}
