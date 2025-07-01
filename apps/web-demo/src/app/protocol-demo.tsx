"use client";

import type { IKVStore } from "@metamask/mobile-wallet-protocol-core";
import { DappClient, type SessionRequest } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import QRCode from "qrcode";
import { useCallback, useEffect, useId, useRef, useState } from "react";

// LocalStorage-based KVStore implementation for demo purposes
class LocalStorageKVStore implements IKVStore {
	private prefix: string;

	constructor(namespace: string) {
		this.prefix = `mwp_${namespace}_`;
	}

	async get(key: string): Promise<string | null> {
		try {
			return localStorage.getItem(this.prefix + key);
		} catch (error) {
			console.error("Error reading from localStorage:", error);
			return null;
		}
	}

	async set(key: string, value: string): Promise<void> {
		try {
			localStorage.setItem(this.prefix + key, value);
		} catch (error) {
			console.error("Error writing to localStorage:", error);
		}
	}

	async remove(key: string): Promise<void> {
		try {
			localStorage.removeItem(this.prefix + key);
		} catch (error) {
			console.error("Error removing from localStorage:", error);
		}
	}
}

type Message = {
	id: string;
	type: "sent" | "received" | "notification" | "system";
	content: string;
	timestamp: Date;
};

type WalletMessage = {
	id: string;
	type: "request" | "response" | "system";
	content: string;
	timestamp: Date;
};

type PendingRequest = {
	id: string;
	method: string;
	params: Record<string, unknown>;
};

export default function ProtocolDemo() {
	// Ensure we're in a browser environment
	useEffect(() => {
		if (typeof window !== "undefined" && !window.WebSocket) {
			console.error("WebSocket not available in this browser");
		}
	}, []);

	// Generate unique IDs for form inputs
	const methodInputId = useId();
	const paramsInputId = useId();

	// DApp state
	const [dappClient, setDappClient] = useState<DappClient | null>(null);
	const [isConnected, setIsConnected] = useState(false);
	const [sessionRequest, setSessionRequest] = useState<SessionRequest | null>(null);
	const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
	const [messages, setMessages] = useState<Message[]>([]);
	const [method, setMethod] = useState("");
	const [params, setParams] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Wallet state
	const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
	const [isWalletConnected, setIsWalletConnected] = useState(false);
	const [walletMessages, setWalletMessages] = useState<WalletMessage[]>([]);
	const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
	const [accounts] = useState(["0x1234567890123456789012345678901234567890"]);
	const walletMessagesEndRef = useRef<HTMLDivElement>(null);

	const scrollToBottom = useCallback(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		walletMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	useEffect(() => {
		scrollToBottom();
	}, [scrollToBottom]);

	const addMessage = (type: Message["type"], content: string) => {
		const newMessage: Message = {
			id: Date.now().toString(),
			type,
			content,
			timestamp: new Date(),
		};
		setMessages((prev) => [...prev, newMessage]);
		console.log(`[DAPP ${type.toUpperCase()}]`, content);
	};

	const addWalletMessage = (type: WalletMessage["type"], content: string) => {
		const newMessage: WalletMessage = {
			id: Date.now().toString() + "-wallet",
			type,
			content,
			timestamp: new Date(),
		};
		setWalletMessages((prev) => [...prev, newMessage]);
		console.log(`[WALLET ${type.toUpperCase()}]`, content);
	};

	const handleConnect = async () => {
		try {
			// Check if WebSocket is available
			if (typeof window === "undefined" || !window.WebSocket) {
				addMessage("system", "WebSocket not available in this environment");
				return;
			}

			addMessage("system", "Creating DApp client...");

			const client = await DappClient.create({
				relayUrl: "ws://localhost:8000/connection/websocket",
				kvstore: new LocalStorageKVStore("dapp"),
			});

			// Set up event listeners
			client.on("session-request", async (request: SessionRequest) => {
				setSessionRequest(request);

				// Generate QR code
				const qrData = JSON.stringify({
					sessionId: request.id,
					publicKey: request.publicKeyB64,
				});

				const qrUrl = await QRCode.toDataURL(qrData, {
					width: 300,
					margin: 2,
					color: {
						dark: "#000000",
						light: "#FFFFFF",
					},
				});
				setQrCodeUrl(qrUrl);

				addMessage("system", `Session request created: ${qrData}`);
			});

			client.on("connected", () => {
				setIsConnected(true);
				addMessage("system", "Connected to wallet!");
			});

			client.on("message", (message: any) => {
				addMessage("received", JSON.stringify(message, null, 2));
			});

			setDappClient(client);

			// Start connection
			await client.connect();
		} catch (error) {
			addMessage("system", `Connection error: ${error}`);
			console.error("Connection error:", error);
		}
	};

	const handleDisconnect = async () => {
		if (dappClient) {
			await dappClient.disconnect();
			setDappClient(null);
			setIsConnected(false);
			setSessionRequest(null);
			setQrCodeUrl("");
			addMessage("system", "Disconnected");
		}
	};

	const handleSendMessage = async () => {
		if (!dappClient || !isConnected || !method) {
			addMessage("system", "Please connect first and provide a method");
			return;
		}

		try {
			let parsedParams = {};
			if (params.trim()) {
				try {
					parsedParams = JSON.parse(params);
				} catch {
					addMessage("system", "Invalid JSON in params field");
					return;
				}
			}

			const request = {
				id: Date.now().toString(),
				method,
				params: parsedParams,
			};

			addMessage("sent", JSON.stringify(request, null, 2));
			await dappClient.sendRequest(request);
		} catch (error) {
			addMessage("system", `Error sending message: ${error}`);
			console.error("Send error:", error);
		}
	};

	// Wallet functions
	const handleWalletConnect = async () => {
		if (!sessionRequest) {
			addWalletMessage("system", "No session request available");
			return;
		}

		try {
			// Check if WebSocket is available
			if (typeof window === "undefined" || !window.WebSocket) {
				addWalletMessage("system", "WebSocket not available in this environment");
				return;
			}

			addWalletMessage("system", "Creating wallet client...");

			const client = await WalletClient.create({
				relayUrl: "ws://localhost:8000/connection/websocket",
				kvstore: new LocalStorageKVStore("wallet"),
			});

			// Set up event listeners
			client.on("connected", () => {
				setIsWalletConnected(true);
				addWalletMessage("system", "Connected to DApp!");
			});

			client.on("message", (message: any) => {
				addWalletMessage("request", JSON.stringify(message, null, 2));
				setPendingRequests((prev) => [...prev, message as PendingRequest]);
			});

			setWalletClient(client);

			// Connect using the session request
			await client.connect({ sessionRequest });
		} catch (error) {
			addWalletMessage("system", `Connection error: ${error}`);
			console.error("Wallet connection error:", error);
		}
	};

	const handleWalletDisconnect = async () => {
		if (walletClient) {
			await walletClient.disconnect();
			setWalletClient(null);
			setIsWalletConnected(false);
			setPendingRequests([]);
			addWalletMessage("system", "Disconnected from DApp");
		}
	};

	const handleApproveRequest = async (request: PendingRequest) => {
		if (!walletClient) return;

		try {
			let result: unknown;

			// Simple mock responses for common methods
			switch (request.method) {
				case "eth_accounts":
					result = accounts;
					break;
				case "eth_chainId":
					result = "0x1"; // Mainnet
					break;
				case "eth_blockNumber":
					result = "0x1234567";
					break;
				case "eth_getBalance":
					result = "0x1bc16d674ec80000"; // 2 ETH
					break;
				case "personal_sign":
					result = "0x" + "a".repeat(130); // Mock signature
					break;
				default:
					result = { success: true, method: request.method };
			}

			const response = {
				id: request.id,
				result,
			};

			await walletClient.sendResponse(response);
			addWalletMessage("response", JSON.stringify(response, null, 2));

			// Remove from pending
			setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
		} catch (error) {
			addWalletMessage("system", `Error sending response: ${error}`);
		}
	};

	const handleRejectRequest = async (request: PendingRequest) => {
		if (!walletClient) return;

		try {
			const response = {
				id: request.id,
				error: {
					code: 4001,
					message: "User rejected the request",
				},
			};

			await walletClient.sendResponse(response);
			addWalletMessage("response", JSON.stringify(response, null, 2));

			// Remove from pending
			setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
		} catch (error) {
			addWalletMessage("system", `Error sending rejection: ${error}`);
		}
	};

	const handleSendNotification = async () => {
		if (!walletClient || !isWalletConnected) return;

		try {
			const notification = {
				method: "accountsChanged",
				params: accounts,
			};

			await walletClient.sendResponse(notification);
			addWalletMessage("system", `Sent notification: ${JSON.stringify(notification)}`);
		} catch (error) {
			addWalletMessage("system", `Error sending notification: ${error}`);
		}
	};

	return (
		<div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
			<div className="max-w-full mx-auto">
				<h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8 text-center">Mobile Wallet Protocol Demo</h1>

				<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
					{/* Left Column - DApp Debug UI */}
					<div className="space-y-6">
						<h2 className="text-2xl font-bold text-gray-900 dark:text-white">DApp Client</h2>

						{/* Connection Panel */}
						<div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
							<h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Connection</h3>

							<div className="space-y-4">
								<div className="flex gap-4">
									{!isConnected ? (
										<button type="button" onClick={handleConnect} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
											Connect
										</button>
									) : (
										<button type="button" onClick={handleDisconnect} className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
											Disconnect
										</button>
									)}

									<div className="flex items-center">
										<div className={`w-3 h-3 rounded-full mr-2 ${isConnected ? "bg-green-500" : "bg-gray-400"}`} />
										<span className="text-gray-700 dark:text-gray-300">{isConnected ? "Connected" : "Disconnected"}</span>
									</div>
								</div>

								{/* QR Code Display */}
								{qrCodeUrl && !isConnected && (
									<div className="mt-6">
										<h4 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">QR Code</h4>
										<div className="bg-white p-4 rounded-lg inline-block">
											<img src={qrCodeUrl} alt="QR Code" className="w-48 h-48" />
										</div>
									</div>
								)}
							</div>
						</div>

						{/* Message Sending Panel */}
						<div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
							<h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Send Request</h3>

							<div className="space-y-4">
								<div>
									<label htmlFor={methodInputId} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
										Method
									</label>
									<input
										id={methodInputId}
										type="text"
										value={method}
										onChange={(e) => setMethod(e.target.value)}
										placeholder="e.g., eth_accounts"
										className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
										disabled={!isConnected}
									/>
								</div>

								<div>
									<label htmlFor={paramsInputId} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
										Params (JSON)
									</label>
									<textarea
										id={paramsInputId}
										value={params}
										onChange={(e) => setParams(e.target.value)}
										placeholder='e.g., {"chainId": 1}'
										rows={3}
										className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
										disabled={!isConnected}
									/>
								</div>

								<button
									type="button"
									onClick={handleSendMessage}
									disabled={!isConnected || !method}
									className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
								>
									Send Request
								</button>
							</div>
						</div>

						{/* DApp Messages Log */}
						<div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
							<h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">DApp Messages</h3>

							<div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 h-64 overflow-y-auto">
								{messages.length === 0 ? (
									<p className="text-gray-500 dark:text-gray-400 text-center">No messages yet. Connect to start.</p>
								) : (
									<div className="space-y-2">
										{messages.map((msg) => (
											<div
												key={msg.id}
												className={`p-3 rounded-lg ${msg.type === "sent"
													? "bg-blue-100 dark:bg-blue-900"
													: msg.type === "received"
														? "bg-green-100 dark:bg-green-900"
														: msg.type === "notification"
															? "bg-yellow-100 dark:bg-yellow-900"
															: "bg-gray-100 dark:bg-gray-800"
													}`}
											>
												<div className="flex justify-between items-start mb-1">
													<span className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">{msg.type}</span>
													<span className="text-xs text-gray-500 dark:text-gray-500">{msg.timestamp.toLocaleTimeString()}</span>
												</div>
												<pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all font-mono">{msg.content}</pre>
											</div>
										))}
										<div ref={messagesEndRef} />
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Right Column - Wallet Demo */}
					<div className="space-y-6">
						<h2 className="text-2xl font-bold text-gray-900 dark:text-white">Wallet Client</h2>

						{/* Wallet Connection */}
						<div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
							<h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Wallet Connection</h3>

							<div className="space-y-4">
								<div className="flex gap-4">
									{!isWalletConnected ? (
										<button
											type="button"
											onClick={handleWalletConnect}
											disabled={!sessionRequest}
											className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
										>
											Connect to DApp
										</button>
									) : (
										<button type="button" onClick={handleWalletDisconnect} className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
											Disconnect
										</button>
									)}

									<div className="flex items-center">
										<div className={`w-3 h-3 rounded-full mr-2 ${isWalletConnected ? "bg-green-500" : "bg-gray-400"}`} />
										<span className="text-gray-700 dark:text-gray-300">{isWalletConnected ? "Connected" : "Disconnected"}</span>
									</div>
								</div>

								{isWalletConnected && (
									<div className="mt-4">
										<p className="text-sm text-gray-600 dark:text-gray-400">Connected Account:</p>
										<p className="font-mono text-sm text-gray-900 dark:text-white break-all">{accounts[0]}</p>

										<button
											type="button"
											onClick={handleSendNotification}
											className="mt-4 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors text-sm"
										>
											Send Account Change Notification
										</button>
									</div>
								)}
							</div>
						</div>

						{/* Pending Requests */}
						{pendingRequests.length > 0 && (
							<div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
								<h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Pending Requests</h3>

								<div className="space-y-4">
									{pendingRequests.map((request) => (
										<div key={request.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
											<p className="font-semibold text-gray-900 dark:text-white mb-2">{request.method}</p>
											{request.params && Object.keys(request.params).length > 0 && (
												<pre className="text-sm text-gray-600 dark:text-gray-400 mb-3 font-mono">{JSON.stringify(request.params, null, 2)}</pre>
											)}
											<div className="flex gap-2">
												<button
													type="button"
													onClick={() => handleApproveRequest(request)}
													className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
												>
													Approve
												</button>
												<button
													type="button"
													onClick={() => handleRejectRequest(request)}
													className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
												>
													Reject
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Wallet Messages Log */}
						<div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
							<h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Wallet Messages</h3>

							<div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 h-64 overflow-y-auto">
								{walletMessages.length === 0 ? (
									<p className="text-gray-500 dark:text-gray-400 text-center">No messages yet. Connect to DApp to start.</p>
								) : (
									<div className="space-y-2">
										{walletMessages.map((msg) => (
											<div
												key={msg.id}
												className={`p-3 rounded-lg ${msg.type === "request" ? "bg-purple-100 dark:bg-purple-900" : msg.type === "response" ? "bg-green-100 dark:bg-green-900" : "bg-gray-100 dark:bg-gray-800"
													}`}
											>
												<div className="flex justify-between items-start mb-1">
													<span className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">{msg.type}</span>
													<span className="text-xs text-gray-500 dark:text-gray-500">{msg.timestamp.toLocaleTimeString()}</span>
												</div>
												<pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all font-mono">{msg.content}</pre>
											</div>
										))}
										<div ref={walletMessagesEndRef} />
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
