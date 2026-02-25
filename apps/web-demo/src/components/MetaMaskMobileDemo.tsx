"use client";

import { type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { DappClient } from "@metamask/mobile-wallet-protocol-dapp-client";
import { useEffect, useRef, useState } from "react";
import { base64Encode, compareEncodingSizes, compressString } from "@/lib/encoding-utils";
import { KeyManager } from "@/lib/KeyManager";
import { LocalStorageKVStore } from "@/lib/localStorage-kvstore";

// const RELAY_URL = "ws://localhost:8000/connection/websocket";
const RELAY_URL = "wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket";
const HARDCODED_ETH_ACCOUNT = "0x3984fd31734648921f9455c71c8a78fa711312bd";
const HARDCODED_SOL_ACCOUNT = "A2k25kuXLKtcorM1C8BvbQYohUrADLqRobBQARY6CtX3";

type LogEntry = {
	id: string;
	type: "sent" | "received" | "notification" | "system";
	content: string;
	timestamp: Date;
};

export default function MetaMaskMobileDemo() {
	// DApp State
	const dappClientRef = useRef<DappClient | null>(null);
	const [dappStatus, setDappStatus] = useState<string>("Not connected");
	const [dappConnected, setDappConnected] = useState(false);
	const [qrCodeData, setQrCodeData] = useState<string>("");
	const [dappLogs, setDappLogs] = useState<LogEntry[]>([]);
	const [sessionTimeLeft, setSessionTimeLeft] = useState<number>(0);
	const sessionTimerId = useRef<NodeJS.Timeout | null>(null);
	const [isSessionExpired, setIsSessionExpired] = useState(false);
	const [results, setResults] = useState<string>("");
	const [dappSessionStore, setDappSessionStore] = useState<SessionStore | null>(null);

	const requestId = useRef(1); // For generating unique JSON-RPC request IDs

	// Refs for auto-scrolling
	const dappLogsRef = useRef<HTMLDivElement>(null);

	// Auto-scroll effect
	useEffect(() => {
		dappLogsRef.current?.scrollTo(0, dappLogsRef.current.scrollHeight);
	}, [dappLogs]);

	const startSessionTimer = (expiresAt: number) => {
		// Clear any existing timer
		if (sessionTimerId.current) {
			clearInterval(sessionTimerId.current);
		}
		setIsSessionExpired(false);

		// Set up interval to update every second
		const timerId = setInterval(() => {
			const now = Date.now();
			const timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
			setSessionTimeLeft(timeLeft);

			if (timeLeft === 0) {
				clearInterval(timerId);
				sessionTimerId.current = null;
				addDappLog("system", "The connection attempt has expired. Please start over.");
				// Fully reset the DApp UI instead of just marking as expired
				resetDappConnectionState();
			}
		}, 1000);

		sessionTimerId.current = timerId;

		const now = Date.now();
		const timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
		setSessionTimeLeft(timeLeft);
	};

	const clearSessionTimer = () => {
		if (sessionTimerId.current) {
			clearInterval(sessionTimerId.current);
			sessionTimerId.current = null;
		}
		setSessionTimeLeft(0);
	};

	// Helper function to create session request and connect with initial payload
	const connectWithSessionRequest = async (onError: (error: Error) => void) => {
		if (!dappClientRef.current) {
			onError(new Error("DApp client not initialized"));
			return;
		}

		try {
			// Create the session creation request to send as initial payload
			const createSessionRequest = {
				jsonrpc: "2.0",
				method: "wallet_createSession",
				params: {
					optionalScopes: {
						"eip155:1": {
							methods: [],
							notifications: [],
						},
						"eip155:137": {
							methods: [],
							notifications: [],
						},
						"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": {
							methods: [],
							notifications: [],
						},
					},
				},
				id: requestId.current++, // Use and increment the request ID
			};

			const messageString = JSON.stringify(createSessionRequest, null, 2);
			addDappLog("sent", messageString);

			// Start new connection, which will trigger 'session-request' and start a new timer
			await dappClientRef.current.connect({
				mode: "trusted",
				initialPayload: createSessionRequest,
			});
		} catch (error) {
			onError(error instanceof Error ? error : new Error("Unknown error"));
		}
	};

	const handleGenerateNewQrCode = async () => {
		if (!dappClientRef.current) return;

		try {
			// Clear existing timer and state
			clearSessionTimer();
			setQrCodeData("");

			// Disconnect and reconnect to generate new session
			await dappClientRef.current.disconnect();
			addDappLog("system", "Generating new QR code...");

			await connectWithSessionRequest((error) => {
				console.error("New QR code generation failed:", error);
				addDappLog("system", `New QR code generation failed: ${error.message}`);
				setDappStatus("Connection failed");
			});
		} catch (error) {
			addDappLog("system", `Failed to generate new QR code: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	// Helper functions for logging
	const addDappLog = (type: LogEntry["type"], content: string) => {
		const newLog: LogEntry = {
			id: Date.now().toString() + Math.random(),
			type,
			content,
			timestamp: new Date(),
		};
		setDappLogs((prev) => [...prev, newLog]);
		console.log(`[${type}] ${content}`);
	};

	// Format time in MM:SS format
	const formatTimeLeft = (seconds: number) => {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
	};

	const resetDappConnectionState = () => {
		clearSessionTimer();
		setQrCodeData("");
		setIsSessionExpired(false);
		setDappStatus("Ready to connect");
	};

	// DApp Functions
	const initializeDappClient = async () => {
		try {
			setDappStatus("Initializing...");
			addDappLog("system", "Creating dApp client...");

			const dappKvStore = new LocalStorageKVStore("metamask-mobile-demo-dapp/");
			const sessionStore = await SessionStore.create(dappKvStore);
			setDappSessionStore(sessionStore);

			const dappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: typeof window !== "undefined" ? WebSocket : undefined,
			});

			const dapp = new DappClient({
				transport: dappTransport,
				sessionstore: sessionStore,
				keymanager: new KeyManager(),
			});
			dappClientRef.current = dapp;

			// Set up event listeners
			dapp.on("session_request", (request: SessionRequest) => {
				addDappLog("system", `Session request generated: ${JSON.stringify(request)}`);

				// 1. Create the higher-level ConnectionRequest object.
				const connectionRequest = {
					sessionRequest: request, // The original session request from the SDK.
					metadata: {
						dapp: {
							name: "MM Demo",
							url: "http://localhost:3000/metamask-mobile-demo",
						},
						sdk: {
							version: "0.1.0",
							platform: "web",
						},
					},
				};

				// 2. Serialize the object to a JSON string.
				const jsonPayload = JSON.stringify(connectionRequest);

				// Compare different encoding methods
				const encodingSizes = compareEncodingSizes(jsonPayload);

				console.log("=== Payload Size Comparison ===");
				console.log("Original JSON length:", encodingSizes.original);
				console.log("URI encoded length:", encodingSizes.uriEncoded);
				console.log("Base64 encoded length:", encodingSizes.base64);
				console.log("Compressed + Base64 length:", encodingSizes.compressed);
				console.log(`Base64 is ${encodingSizes.stats.base64Reduction.toFixed(2)}% smaller than URI encoding`);
				console.log(`Compressed + Base64 is ${encodingSizes.stats.compressionReduction.toFixed(2)}% smaller than URI encoding`);
				console.log("===============================");

				// Log the comparison to the UI as well
				addDappLog(
					"system",
					`Payload sizes - JSON: ${encodingSizes.original}, URI: ${encodingSizes.uriEncoded}, Base64: ${encodingSizes.base64}, Compressed: ${encodingSizes.compressed}`,
				);
				addDappLog("system", `Size reductions - Base64: ${encodingSizes.stats.base64Reduction.toFixed(1)}%, Compressed: ${encodingSizes.stats.compressionReduction.toFixed(1)}%`);

				// 4. Construct the full deep link URL using base64 encoding
				// Using base64 encoded payload instead of URI encoded
				const base64Payload = base64Encode(jsonPayload);
				const uriEncodedPayload = encodeURIComponent(jsonPayload);
				const deepLinkUrl = `metamask://connect/mwp?p=${uriEncodedPayload}`;

				// Also show what the compressed URL would look like
				const compressedPayload = encodeURIComponent(compressString(jsonPayload));
				const compressedDeepLinkUrl = `metamask://connect/mwp?p=${compressedPayload}&c=1`; // c=1 indicates compressed

				console.log("Standard deep link length:", deepLinkUrl.length);
				console.log("Compressed deep link length:", compressedDeepLinkUrl.length);

				setQrCodeData(compressedDeepLinkUrl);
				addDappLog("system", "QR code generated with base64 encoded deep link. Ready for wallet to scan.");

				// Start session timer
				startSessionTimer(request.expiresAt);
			});

			dapp.on("connected", () => {
				addDappLog("system", "DApp connected to wallet! Session creation request sent as initial payload. Waiting for wallet approval...");
				setDappConnected(true);
				setDappStatus("Connected");
				clearSessionTimer();
			});

			dapp.on("disconnected", () => {
				addDappLog("system", "DApp disconnected from wallet");
				setDappConnected(false);
				resetDappConnectionState(); // Use the reset function here
			});

			dapp.on("message", (payload: unknown) => {
				const payloadString = JSON.stringify(payload, null, 2);
				addDappLog("received", payloadString);

				// TRY TO PARSE AND STORE THE RESULT
				try {
					let parsed: any;
					if (typeof payload === "string") {
						parsed = JSON.parse(payload);
					} else if (typeof payload === "object" && payload !== null) {
						parsed = payload;
					}

					// Check if this is the response for our createSession request
					if (parsed.result && parsed.result.sessionScopes) {
						setResults(JSON.stringify(parsed.result, null, 2));
						addDappLog("system", "Multi-chain session established and details stored.");
					} else if (parsed.result) {
						setResults(JSON.stringify(parsed, null, 2));
					}
				} catch {
					// Not a JSON response, do nothing with the results display.
				}
			});

			dapp.on("error", (error: Error) => {
				addDappLog("system", `DApp error: ${error.message}`);
			});

			// Try to resume existing session
			try {
				const sessions = await sessionStore.list();
				if (sessions.length > 0) {
					const latestSession = sessions[0];
					addDappLog("system", `Found existing session: ${latestSession.id}, attempting to resume...`);

					if (dappClientRef.current) {
						await dappClientRef.current.resume(latestSession.id);
						setDappConnected(true);
						setDappStatus("Resumed existing session");
						addDappLog("system", "Successfully resumed existing session");
					}
				} else {
					setDappStatus("Ready to connect");
					addDappLog("system", "DApp client initialized successfully");
				}
			} catch (error) {
				setDappStatus("Ready to connect");
				addDappLog("system", `DApp client initialized successfully (session resume failed: ${error instanceof Error ? error.message : "Unknown error"})`);
			}
		} catch (error) {
			addDappLog("system", `Failed to initialize dApp: ${error instanceof Error ? error.message : "Unknown error"}`);
			setDappStatus("Initialization failed");
		}
	};

	const handleDappConnect = async () => {
		if (!dappClientRef.current) {
			await initializeDappClient();
			return;
		}

		try {
			setDappStatus("Connecting...");
			addDappLog("system", "Starting connection process...");

			await connectWithSessionRequest((error) => {
				addDappLog("system", `Connection failed: ${error.message}`);
				setDappStatus("Connection failed");
			});
		} catch (error) {
			addDappLog("system", `Connection error: ${error instanceof Error ? error.message : "Unknown error"}`);
			setDappStatus("Connection failed");
		}
	};

	const handleDappDisconnect = async () => {
		if (dappClientRef.current) {
			try {
				await dappClientRef.current.disconnect();
				// All state clearing is now handled by the 'disconnected' event listener
				// or by this reset function for a clean UI immediately.
				resetDappConnectionState();
				addDappLog("system", "Disconnected from wallet");
			} catch (error) {
				addDappLog("system", `Disconnect error: ${error instanceof Error ? error.message : "Unknown error"}`);
			}
		}
	};

	const getNextId = () => requestId.current++;

	const handleGetEthBalance = async () => {
		if (!dappClientRef.current || !dappConnected) return;
		try {
			setResults("");
			const invokeRequest = {
				id: getNextId(),
				jsonrpc: "2.0",
				method: "wallet_invokeMethod",
				params: {
					scope: "eip155:1",
					request: {
						method: "eth_getBalance",
						params: [HARDCODED_ETH_ACCOUNT, "latest"],
					},
				},
			};
			addDappLog("sent", JSON.stringify(invokeRequest, null, 2));
			await dappClientRef.current.sendRequest(invokeRequest);
		} catch (error) {
			addDappLog("system", `Send error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleEvmPersonalSign = async () => {
		if (!dappClientRef.current || !dappConnected) return;
		try {
			setResults("");
			const invokeRequest = {
				id: getNextId(),
				jsonrpc: "2.0",
				method: "wallet_invokeMethod",
				params: {
					scope: "eip155:1",
					request: {
						method: "personal_sign",
						params: ["0x48656c6c6f20576f726c64", HARDCODED_ETH_ACCOUNT],
					},
				},
			};
			addDappLog("sent", JSON.stringify(invokeRequest, null, 2));
			await dappClientRef.current.sendRequest(invokeRequest);
		} catch (error) {
			addDappLog("system", `Send error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleEvmTransaction = async () => {
		if (!dappClientRef.current || !dappConnected) return;
		try {
			setResults("");
			const invokeRequest = {
				id: getNextId(),
				jsonrpc: "2.0",
				method: "wallet_invokeMethod",
				params: {
					scope: "eip155:1", // Target Polygon
					request: {
						method: "eth_sendTransaction",
						params: [
							{
								from: HARDCODED_ETH_ACCOUNT,
								to: "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
								value: "0x0",
							},
						],
					},
				},
			};
			addDappLog("sent", JSON.stringify(invokeRequest, null, 2));
			await dappClientRef.current.sendRequest(invokeRequest);
		} catch (error) {
			addDappLog("system", `Send error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleSolanaSignMessage = async () => {
		if (!dappClientRef.current || !dappConnected) return;
		try {
			setResults("");
			const invokeRequest = {
				id: getNextId(),
				jsonrpc: "2.0",
				method: "wallet_invokeMethod",
				params: {
					scope: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
					request: {
						method: "signMessage",
						params: {
							account: { address: HARDCODED_SOL_ACCOUNT },
							message: "SGVsbG8sIHdvcmxkIQ==", // "Hello, world!" in Base64
						},
					},
				},
			};
			addDappLog("sent", JSON.stringify(invokeRequest, null, 2));
			await dappClientRef.current.sendRequest(invokeRequest);
		} catch (error) {
			addDappLog("system", `Send error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	// Initialize clients and try to resume sessions on mount
	useEffect(() => {
		const initializeAndResume = async () => {
			await initializeDappClient();
		};

		initializeAndResume();

		// Cleanup timer on unmount
		return () => {
			clearSessionTimer();
		};
	}, []);

	return (
		<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
			<div className="grid gap-6 grid-cols-1 max-w-4xl mx-auto">
				{/* Left Column - DApp Client */}
				<div className="space-y-6">
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-3">
							<h3 className="text-xl font-bold text-gray-900 dark:text-white">MetaMask Mobile App Demo</h3>
							<div className="flex items-center gap-2">
								<div className={`w-3 h-3 rounded-full ${dappConnected ? "bg-green-500" : "bg-gray-400"}`}></div>
								<span className="text-sm text-gray-600 dark:text-gray-400">{dappStatus}</span>
							</div>
						</div>
					</div>

					{/* DApp Connection Panel */}
					<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
						<h4 className="font-semibold mb-4 text-gray-900 dark:text-white">Connection</h4>

						<div className="space-y-4">
							<div className="flex gap-3">
								{!dappConnected ? (
									<button
										type="button"
										onClick={handleDappConnect}
										disabled={!dappClientRef.current || (!!qrCodeData && !isSessionExpired)}
										className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
									>
										{dappClientRef.current ? "Connect" : "Initialize & Connect"}
									</button>
								) : (
									<button type="button" onClick={handleDappDisconnect} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors">
										Disconnect
									</button>
								)}
							</div>

							{qrCodeData && !dappConnected && (
								<div className="mt-4 text-center">
									{" "}
									{/* Centering the content */}
									<div className="flex items-center justify-between mb-2">
										<h5 className="font-medium text-gray-900 dark:text-white">Connect with Mobile Wallet</h5>
										{isSessionExpired ? (
											<span className="text-sm text-red-600 dark:text-red-400 font-medium">Session expired</span>
										) : (
											sessionTimeLeft > 0 && <span className="text-sm text-orange-600 dark:text-orange-400 font-medium">Expires in {formatTimeLeft(sessionTimeLeft)}</span>
										)}
									</div>
									<div className={`bg-white p-4 rounded-lg inline-block transition-opacity ${isSessionExpired ? "opacity-50" : ""}`}>
										<QRCodeDisplay data={qrCodeData} />
									</div>
									<div className="mt-4">
										<p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
											{isSessionExpired ? "This QR code has expired." : "Scan with your mobile wallet or use the link below."}
										</p>
										{!isSessionExpired ? (
											<a
												href={qrCodeData}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm"
											>
												Open in MetaMask Mobile
											</a>
										) : (
											<button
												type="button"
												onClick={handleGenerateNewQrCode}
												className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm"
											>
												Generate New QR Code
											</button>
										)}
									</div>
								</div>
							)}
						</div>
					</div>

					{/* DApp Actions */}
					<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
						<h4 className="font-semibold mb-4 text-gray-900 dark:text-white">Multi-Chain Test Actions</h4>
						<div className="space-y-3">
							<button
								type="button"
								onClick={handleGetEthBalance}
								disabled={!dappConnected}
								className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
							>
								Get ETH Balance (Read)
							</button>
							<button
								type="button"
								onClick={handleEvmPersonalSign}
								disabled={!dappConnected}
								className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
							>
								Personal Sign on Polygon (Sign)
							</button>
							<button
								type="button"
								onClick={handleEvmTransaction}
								disabled={!dappConnected}
								className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
							>
								Send ETH Transaction (Write)
							</button>
							<button
								type="button"
								onClick={handleSolanaSignMessage}
								disabled={!dappConnected}
								className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
							>
								Sign Message on Solana (Sign)
							</button>
						</div>

						{results && (
							<div className="mt-4 border-t-2 border-dashed border-gray-300 dark:border-gray-600 pt-4">
								<h5 className="font-medium text-gray-900 dark:text-white mb-2">Result</h5>
								<pre className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 text-xs whitespace-pre-wrap break-all font-mono">{results}</pre>
							</div>
						)}
					</div>

					{/* DApp Activity Log */}
					<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
						<h4 className="font-semibold mb-4 text-gray-900 dark:text-white">Activity Log</h4>

						<div ref={dappLogsRef} className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 h-64 overflow-y-auto">
							{dappLogs.length === 0 ? (
								<p className="text-gray-500 dark:text-gray-400 text-center text-sm">No activity yet</p>
							) : (
								<div className="space-y-2">
									{dappLogs.map((log) => (
										<div
											key={log.id}
											className={`p-2 rounded text-xs ${
												log.type === "sent"
													? "bg-blue-100 dark:bg-blue-900"
													: log.type === "received"
														? "bg-green-100 dark:bg-green-900"
														: log.type === "notification"
															? "bg-yellow-100 dark:bg-yellow-900"
															: "bg-gray-200 dark:bg-gray-700"
											}`}
										>
											<div className="flex justify-between items-start mb-1">
												<span className="font-medium uppercase">{log.type}</span>
												<span className="text-gray-500">{log.timestamp.toLocaleTimeString()}</span>
											</div>
											<pre className="whitespace-pre-wrap break-all font-mono">{log.content}</pre>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			<div className="text-xs text-gray-500 dark:text-gray-400 text-center">
				<p>Note: This demo requires a WebSocket relay server running on localhost:8000</p>
				<p>Run `docker compose -f backend/docker-compose.yml up -d` to start the backend</p>
				<p>The dApp interface can connect to external mobile wallets via QR code scanning</p>
			</div>
		</div>
	);
}

// QR Code Display Component
function QRCodeDisplay({ data }: { data: string }) {
	const [qrUrl, setQrUrl] = useState<string>("");

	useEffect(() => {
		let mounted = true;

		const generateQR = async () => {
			try {
				const { default: QRCode } = await import("qrcode");
				const url = await QRCode.toDataURL(data, {
					width: 200,
					margin: 2,
					color: {
						dark: "#000000",
						light: "#FFFFFF",
					},
				});
				if (mounted) {
					setQrUrl(url);
				}
			} catch (error) {
				console.error("QR Code generation failed:", error);
			}
		};

		generateQR();

		return () => {
			mounted = false;
		};
	}, [data]);

	if (!qrUrl) {
		return (
			<div className="w-[200px] h-[200px] bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center">
				<span className="text-gray-500 text-sm">Generating QR...</span>
			</div>
		);
	}

	return <img src={qrUrl} alt="Connection QR Code" className="w-[200px] h-[200px]" />;
}
