/**
 * Defines the contract for a communication transport.
 * This allows the protocol to be agnostic to the underlying
 * communication mechanism (e.g., WebSocket, Deep Link).
 *
 * It is designed around a simple, channel-based publish/subscribe model.
 */
export interface ITransport {
	/** Establishes a connection. */
	connect(): Promise<void>;

	/** Disconnects. */
	disconnect(): Promise<void>;

	/**
	 * Publishes a message to a specific channel.
	 * @param channel The channel to publish the message to.
	 * @param message The message payload to send.
	 */
	publish(channel: string, message: string): Promise<void>;

	/**
	 * Subscribes to a channel to begin receiving messages.
	 * @param channel The channel to subscribe to.
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
}
