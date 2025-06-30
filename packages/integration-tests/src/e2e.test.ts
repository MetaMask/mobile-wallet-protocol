import type { SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import { InMemoryKVStore } from "@metamask/mobile-wallet-protocol-core";
import { DappClient } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import * as t from "vitest";
import WebSocket from "ws";

// This is the relay server URL defined in your docker-compose setup
const RELAY_URL = "ws://localhost:8000/connection/websocket";

t.describe("DappClient & WalletClient Integration", () => {
	let dappClient: DappClient;
	let walletClient: WalletClient;

	t.afterEach(async () => {
		// Ensure clients are disconnected after each test
		if (dappClient) {
			dappClient.removeAllListeners();
			await dappClient.disconnect();
		}
		if (walletClient) {
			walletClient.removeAllListeners();
			await walletClient.disconnect();
		}
		// Give some time for cleanup
		await new Promise((resolve) => setTimeout(resolve, 100));
	});

	t.test(
		"should establish a connection and exchange messages",
		async () => {
			// 1. Initialize both clients
			// We pass the 'ws' package constructor for the Node.js test environment
			dappClient = await DappClient.create({
				relayUrl: RELAY_URL,
				websocket: WebSocket,
				kvstore: new InMemoryKVStore(),
			});
			walletClient = await WalletClient.create({
				relayUrl: RELAY_URL,
				websocket: WebSocket,
				kvstore: new InMemoryKVStore(),
			});

			// Add error event listeners to prevent unhandled errors
			dappClient.on("error", (error) => {
				throw new Error(`DappClient error: ${error.message}`);
			});
			walletClient.on("error", (error) => {
				throw new Error(`WalletClient error: ${error.message}`);
			});

			// 2. Set up promises to wait for key events.
			const dappConnectedPromise = new Promise<void>((resolve) => dappClient.once("connected", resolve));
			const walletConnectedPromise = new Promise<void>((resolve) => walletClient.once("connected", resolve));
			const sessionRequestPromise = new Promise<SessionRequest>((resolve) => dappClient.once("session-request", resolve));

			// 3. Start the dapp client's connection process
			await dappClient.connect();

			// 4. SIMULATE SESSION REQUEST TRANSFER: Wait for the DappClient to emit the session request...
			const sessionRequest = await sessionRequestPromise;
			t.expect(sessionRequest).toBeDefined();
			t.expect(typeof sessionRequest.id).toBe("string");
			t.expect(typeof sessionRequest.publicKeyB64).toBe("string");

			// ...and immediately use it to connect the WalletClient.
			await walletClient.connect({ sessionRequest });

			// 5. Wait for both clients to emit their "connected" event, confirming the handshake is complete.
			await Promise.all([dappConnectedPromise, walletConnectedPromise]);

			// 6. VERIFY COMMUNICATION: Dapp -> Wallet
			const messageFromDapp = { type: "ping", data: "hello wallet!" };
			const messageReceivedByWalletPromise = new Promise<unknown>((resolve) => walletClient.once("message", resolve));

			await dappClient.sendRequest(messageFromDapp);

			const receivedAtWallet = await messageReceivedByWalletPromise;
			t.expect(receivedAtWallet).toEqual(messageFromDapp);

			// 7. VERIFY COMMUNICATION: Wallet -> Dapp
			const messageFromWallet = { type: "pong", data: "hello dapp!" };
			const messageReceivedByDappPromise = new Promise<unknown>((resolve) => dappClient.once("message", resolve));

			await walletClient.sendResponse(messageFromWallet);

			const receivedAtDapp = await messageReceivedByDappPromise;
			t.expect(receivedAtDapp).toEqual(messageFromWallet);
		},
		10000,
	); // Increase timeout for integration test
});
