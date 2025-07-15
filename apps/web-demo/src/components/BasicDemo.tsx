"use client";

import { type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { DappClient } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import { useEffect, useState } from "react";
import { LocalStorageKVStore } from "@/lib/localStorage-kvstore";

const RELAY_URL = "ws://localhost:8000/connection/websocket";

export default function BasicDemo() {
	const [status, setStatus] = useState<string>("Initializing...");
	const [dappClient, setDappClient] = useState<DappClient | null>(null);
	const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
	const [sessionRequest, setSessionRequest] = useState<SessionRequest | null>(null);
	const [isConnected, setIsConnected] = useState(false);

	useEffect(() => {
		let mounted = true;

		const initializeClients = async () => {
			try {
				setStatus("Creating storage and transports...");

				// Create separate storage for dapp and wallet
				const dappKvStore = new LocalStorageKVStore("dapp-");
				const walletKvStore = new LocalStorageKVStore("wallet-");

				const dappSessionStore = new SessionStore(dappKvStore);
				const walletSessionStore = new SessionStore(walletKvStore);

				// Create transports (in a real app, these would be separate instances)
				const dappTransport = await WebSocketTransport.create({
					url: RELAY_URL,
					kvstore: dappKvStore,
					websocket: typeof window !== "undefined" ? WebSocket : undefined,
				});

				const walletTransport = await WebSocketTransport.create({
					url: RELAY_URL,
					kvstore: walletKvStore,
					websocket: typeof window !== "undefined" ? WebSocket : undefined,
				});

				if (!mounted) return;

				setStatus("Creating clients...");

				// Create clients
				const dapp = new DappClient({
					transport: dappTransport,
					sessionstore: dappSessionStore,
				});

				const wallet = new WalletClient({
					transport: walletTransport,
					sessionstore: walletSessionStore,
				});

				// Set up event listeners
				dapp.on("session-request", (request: SessionRequest) => {
					console.log("Session request received:", request);
					setSessionRequest(request);
				});

				dapp.on("connected", () => {
					console.log("Dapp connected");
					setIsConnected(true);
				});

				dapp.on("message", (payload: unknown) => {
					console.log("Dapp received message:", payload);
				});

				wallet.on("connected", () => {
					console.log("Wallet connected");
				});

				wallet.on("message", (payload: unknown) => {
					console.log("Wallet received message:", payload);
				});

				dapp.on("error", (error: Error) => {
					console.error("Dapp error:", error);
					setStatus(`Dapp error: ${error.message}`);
				});

				wallet.on("error", (error: Error) => {
					console.error("Wallet error:", error);
					setStatus(`Wallet error: ${error.message}`);
				});

				if (!mounted) return;

				setDappClient(dapp);
				setWalletClient(wallet);

				// Check for existing sessions and try to resume
				setStatus("Checking for existing sessions...");
				await tryResumeExistingSessions(dapp, wallet, dappSessionStore, walletSessionStore);
			} catch (error) {
				console.error("Failed to initialize clients:", error);
				if (mounted) {
					setStatus(`Initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`);
				}
			}
		};

		const tryResumeExistingSessions = async (dapp: DappClient, wallet: WalletClient, dappSessionStore: SessionStore, walletSessionStore: SessionStore) => {
			try {
				// Check for existing sessions in both stores
				const [dappSessions, walletSessions] = await Promise.all([dappSessionStore.list(), walletSessionStore.list()]);

				console.log("Found sessions:", { dappSessions, walletSessions });

				// Try to resume dapp session
				if (dappSessions.length > 0) {
					const latestDappSession = dappSessions[0]; // Get the most recent session
					setStatus(`Resuming dapp session ${latestDappSession.id}...`);

					try {
						await dapp.resume(latestDappSession.id);
						console.log("Dapp session resumed successfully");
						setIsConnected(true);
					} catch (error) {
						console.log("Failed to resume dapp session:", error);
						// Session might be expired, continue without it
					}
				}

				// Try to resume wallet session
				if (walletSessions.length > 0) {
					const latestWalletSession = walletSessions[0]; // Get the most recent session
					setStatus(`Resuming wallet session ${latestWalletSession.id}...`);

					try {
						await wallet.resume(latestWalletSession.id);
						console.log("Wallet session resumed successfully");
					} catch (error) {
						console.log("Failed to resume wallet session:", error);
						// Session might be expired, continue without it
					}
				}

				// Set final status based on what was resumed
				if (dappSessions.length > 0 || walletSessions.length > 0) {
					setStatus("Session resumption completed. Ready to continue!");
				} else {
					setStatus("No existing sessions found. Ready to start new connection!");
				}
			} catch (error) {
				console.error("Error during session resumption:", error);
				setStatus("Session resumption failed. Ready to start new connection!");
			}
		};

		initializeClients();

		return () => {
			mounted = false;
		};
	}, []);

	const handleConnect = async () => {
		if (!dappClient || !walletClient) {
			setStatus("Clients not initialized");
			return;
		}

		try {
			// Reset state for fresh connection
			setIsConnected(false);
			setSessionRequest(null);
			setStatus("Starting fresh connection...");

			// Disconnect existing sessions if any
			try {
				await Promise.all([dappClient.disconnect(), walletClient.disconnect()]);
			} catch {
				console.log("No existing sessions to disconnect");
			}

			// Start the dapp connection process
			dappClient.connect().catch((error) => {
				console.error("Dapp connection failed:", error);
				setStatus(`Dapp connection failed: ${error.message}`);
			});

			// Wait for session request
			setStatus("Waiting for session request...");
		} catch (error) {
			console.error("Connection failed:", error);
			setStatus(`Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleWalletConnect = async () => {
		if (!walletClient || !sessionRequest) {
			setStatus("Wallet client or session request not available");
			return;
		}

		try {
			setStatus("Wallet connecting...");
			await walletClient.connect({ sessionRequest });
			setStatus("Wallet connected! Both clients are now connected.");
		} catch (error) {
			console.error("Wallet connection failed:", error);
			setStatus(`Wallet connection failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleSendTestMessage = async () => {
		if (!dappClient || !walletClient || !isConnected) {
			setStatus("Not ready to send messages");
			return;
		}

		try {
			setStatus("Sending test message...");
			await dappClient.sendRequest({
				jsonrpc: "2.0",
				method: "test_method",
				params: ["Hello from dapp!"],
			});
			setStatus("Test message sent!");
		} catch (error) {
			console.error("Failed to send message:", error);
			setStatus(`Send failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleDisconnect = async () => {
		try {
			setStatus("Disconnecting...");
			await Promise.all([dappClient?.disconnect(), walletClient?.disconnect()]);
			setIsConnected(false);
			setSessionRequest(null);
			setStatus("Disconnected");
		} catch (error) {
			console.error("Disconnect failed:", error);
			setStatus(`Disconnect failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	return (
		<div className="max-w-2xl mx-auto space-y-6">
			<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
				<h3 className="font-semibold mb-3 text-gray-900 dark:text-white">Status:</h3>
				<p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 p-3 rounded font-mono">{status}</p>
			</div>

			<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
				<h3 className="font-semibold mb-4 text-gray-900 dark:text-white">Client Status:</h3>
				<div className="space-y-3">
					<div className="flex items-center gap-3">
						<span className={`w-3 h-3 rounded-full ${dappClient ? "bg-green-500" : "bg-gray-400"}`}></span>
						<span className="text-gray-700 dark:text-gray-300">
							Dapp Client: <span className="font-medium">{dappClient ? "Initialized" : "Not ready"}</span>
						</span>
					</div>
					<div className="flex items-center gap-3">
						<span className={`w-3 h-3 rounded-full ${walletClient ? "bg-green-500" : "bg-gray-400"}`}></span>
						<span className="text-gray-700 dark:text-gray-300">
							Wallet Client: <span className="font-medium">{walletClient ? "Initialized" : "Not ready"}</span>
						</span>
					</div>
					<div className="flex items-center gap-3">
						<span className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500" : sessionRequest ? "bg-yellow-500" : "bg-gray-400"}`}></span>
						<span className="text-gray-700 dark:text-gray-300">
							Session: <span className="font-medium">{isConnected ? "Accepted/Resumed" : sessionRequest ? "Requested" : "None"}</span>
						</span>
					</div>
					<div className="flex items-center gap-3">
						<span className={`w-3 h-3 rounded-full ${isConnected ? "bg-green-500" : "bg-gray-400"}`}></span>
						<span className="text-gray-700 dark:text-gray-300">
							Connected: <span className="font-medium">{isConnected ? "Yes" : "No"}</span>
						</span>
					</div>
				</div>
			</div>

			<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
				<h3 className="font-semibold mb-4 text-gray-900 dark:text-white">Actions:</h3>
				<div className="space-y-3">
					<button
						type="button"
						onClick={handleConnect}
						disabled={!dappClient || !walletClient || isConnected}
						className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:cursor-not-allowed focus:outline-none focus:ring-0"
					>
						1. Start Dapp Connection
					</button>

					<button
						type="button"
						onClick={handleWalletConnect}
						disabled={!sessionRequest || isConnected}
						className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:cursor-not-allowed focus:outline-none focus:ring-0"
					>
						2. Connect Wallet
					</button>

					<button
						type="button"
						onClick={handleSendTestMessage}
						disabled={!isConnected}
						className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:text-gray-500 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:cursor-not-allowed focus:outline-none focus:ring-0"
					>
						3. Send Test Message
					</button>

					<button
						type="button"
						onClick={handleDisconnect}
						disabled={!dappClient && !walletClient}
						className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:cursor-not-allowed focus:outline-none focus:ring-0"
					>
						Disconnect
					</button>
				</div>
			</div>

			<div className="text-xs text-gray-500 dark:text-gray-400 mt-4">
				<p>Note: This demo requires a WebSocket relay server running on localhost:8000</p>
				<p>Run `docker compose -f backend/docker-compose.yml up -d` to start the backend</p>
			</div>
		</div>
	);
}
