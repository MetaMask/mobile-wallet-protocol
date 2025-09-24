"use client";

import { ErrorCode, SessionError, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { DappClient, type OtpRequiredPayload } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import { useEffect, useRef, useState } from "react";
import { KeyManager } from "@/lib/KeyManager";
import { LocalStorageKVStore } from "@/lib/localStorage-kvstore";

const RELAY_URL = "ws://localhost:8000/connection/websocket";

type LogEntry = {
	id: string;
	type: "sent" | "received" | "notification" | "system";
	content: string;
	timestamp: Date;
};

type WalletLogEntry = {
	id: string;
	type: "request" | "response" | "system" | "notification";
	content: string;
	timestamp: Date;
};

type PendingRequest = {
	id: string;
	method: string;
	params: unknown;
	timestamp: Date;
};

export default function UntrustedDemo() {
	// UI State
	const [showWalletClient, setShowWalletClient] = useState(true);

	// DApp State
	const [dappClient, setDappClient] = useState<DappClient | null>(null);
	const [dappStatus, setDappStatus] = useState<string>("Not connected");
	const [dappConnected, setDappConnected] = useState(false);
	const [sessionRequest, setSessionRequest] = useState<SessionRequest | null>(null);
	const [qrCodeData, setQrCodeData] = useState<string>("");
	const [dappLogs, setDappLogs] = useState<LogEntry[]>([]);
	const [dappMessage, setDappMessage] = useState("Hello from DApp!");
	const [sessionTimeLeft, setSessionTimeLeft] = useState<number>(0);
	const [sessionTimerId, setSessionTimerId] = useState<NodeJS.Timeout | null>(null);
	const [isSessionExpired, setIsSessionExpired] = useState(false);
	const [otpInputValue, setOtpInputValue] = useState("");
	const [otpPayload, setOtpPayload] = useState<OtpRequiredPayload | null>(null);

	// Wallet State
	const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
	const [walletStatus, setWalletStatus] = useState<string>("Not connected");
	const [walletConnected, setWalletConnected] = useState(false);
	const [walletLogs, setWalletLogs] = useState<WalletLogEntry[]>([]);
	const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
	const [walletMessage, setWalletMessage] = useState("Hello from Wallet!");
	const [displayedOtp, setDisplayedOtp] = useState<string>("");
	const [otpDeadline, setOtpDeadline] = useState<number>(0);

	// Refs for auto-scrolling
	const dappLogsRef = useRef<HTMLDivElement>(null);
	const walletLogsRef = useRef<HTMLDivElement>(null);

	// Auto-scroll effect
	useEffect(() => {
		dappLogsRef.current?.scrollTo(0, dappLogsRef.current.scrollHeight);
		walletLogsRef.current?.scrollTo(0, walletLogsRef.current.scrollHeight);
	}, [dappLogs, walletLogs]);

	const startSessionTimer = (expiresAt: number) => {
		// Clear any existing timer
		if (sessionTimerId) {
			clearInterval(sessionTimerId);
		}
		setIsSessionExpired(false);

		// Set up interval to update every second
		const timerId = setInterval(() => {
			const now = Date.now();
			const timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
			setSessionTimeLeft(timeLeft);

			if (timeLeft === 0) {
				clearInterval(timerId);
				setSessionTimerId(null);
				addDappLog("system", "The connection attempt has expired. Please start over.");
				// Fully reset the DApp UI instead of just marking as expired
				resetDappConnectionState();
			}
		}, 1000);

		setSessionTimerId(timerId);

		const now = Date.now();
		const timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000));
		setSessionTimeLeft(timeLeft);
	};

	const clearSessionTimer = () => {
		if (sessionTimerId) {
			clearInterval(sessionTimerId);
			setSessionTimerId(null);
		}
		setSessionTimeLeft(0);
	};

	const handleGenerateNewQrCode = async () => {
		if (!dappClient) return;

		try {
			// Clear existing timer and state
			clearSessionTimer();
			setSessionRequest(null);
			setQrCodeData("");

			// Disconnect and reconnect to generate new session
			await dappClient.disconnect();
			addDappLog("system", "Generating new QR code with initial payload...");

			// Define the initial message to be sent
			const initialPayload = "Hello from new QR Code";
			addDappLog("sent", `Queuing initial payload: ${JSON.stringify(initialPayload, null, 2)}`);

			// Start new connection, which will trigger 'session-request' and start a new timer
			dappClient.connect({ initialPayload }).catch((error) => {
				console.error("New QR code generation failed:", error);
				addDappLog("system", `New QR code generation failed: ${error.message}`);
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
	};

	// Format time in MM:SS format
	const formatTimeLeft = (seconds: number) => {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
	};

	const addWalletLog = (type: WalletLogEntry["type"], content: string) => {
		const newLog: WalletLogEntry = {
			id: Date.now().toString() + Math.random(),
			type,
			content,
			timestamp: new Date(),
		};
		setWalletLogs((prev) => [...prev, newLog]);
	};

	const resetDappConnectionState = () => {
		clearSessionTimer();
		setSessionRequest(null);
		setQrCodeData("");
		setOtpInputValue("");
		setOtpPayload(null);
		setIsSessionExpired(false);
		setDappStatus("Ready to connect");
	};

	// DApp Functions
	const initializeDappClient = async () => {
		try {
			setDappStatus("Initializing...");
			addDappLog("system", "Creating dApp client...");

			const dappKvStore = new LocalStorageKVStore("untrusted-demo-dapp-");
			const dappSessionStore = new SessionStore(dappKvStore);

			const dappTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: dappKvStore,
				websocket: typeof window !== "undefined" ? WebSocket : undefined,
			});

			const dapp = new DappClient({
				transport: dappTransport,
				sessionstore: dappSessionStore,
				keymanager: new KeyManager(),
			});

			// Set up event listeners
			dapp.on("session_request", (request: SessionRequest) => {
				addDappLog("system", `Session request generated: ${request.id}`);
				setSessionRequest(request);

				// Generate QR code data with the raw session request JSON
				const qrData = JSON.stringify(request);
				setQrCodeData(qrData);
				addDappLog("system", "QR code generated. Ready for wallet to scan.");

				// Start session timer
				startSessionTimer(request.expiresAt);
			});

			dapp.on("connected", () => {
				addDappLog("system", "DApp connected to wallet!");
				setDappConnected(true);
				setDappStatus("Connected");
				clearSessionTimer(); // Clear timer on successful connection
			});

			dapp.on("disconnected", () => {
				addDappLog("system", "DApp disconnected from wallet");
				setDappConnected(false);
				resetDappConnectionState(); // Use the reset function here
			});

			dapp.on("message", (payload: unknown) => {
				addDappLog("received", JSON.stringify(payload, null, 2));
			});

			dapp.on("error", (error: Error) => {
				addDappLog("system", `DApp error: ${error.message}`);
			});

			dapp.on("otp_required", (payload: OtpRequiredPayload) => {
				addDappLog("system", "OTP Required. Enter the code displayed on your wallet.");
				setOtpPayload(payload);
				// Use the session timer to show OTP expiration
				startSessionTimer(payload.deadline);
			});

			setDappClient(dapp);

			// Try to resume existing session
			try {
				const sessions = await dappSessionStore.list();
				if (sessions.length > 0) {
					const latestSession = sessions[0];
					addDappLog("system", `Found existing session: ${latestSession.id}, attempting to resume...`);

					await dapp.resume(latestSession.id);
					setDappConnected(true);
					setDappStatus("Resumed existing session");
					addDappLog("system", "Successfully resumed existing session");
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
		if (!dappClient) {
			await initializeDappClient();
			return;
		}

		try {
			setDappStatus("Connecting...");
			addDappLog("system", "Starting connection process with initial payload...");

			// Define the initial message to be sent
			const initialPayload = "Hello from Untrusted Demo!";
			addDappLog("sent", `Queuing initial payload: ${JSON.stringify(initialPayload, null, 2)}`);

			// This will trigger the session-request event and generate QR code
			dappClient.connect({ initialPayload }).catch((error) => {
				addDappLog("system", `Connection failed: ${error.message}`);
				setDappStatus("Connection failed");
			});
		} catch (error) {
			addDappLog("system", `Connection error: ${error instanceof Error ? error.message : "Unknown error"}`);
			setDappStatus("Connection failed");
		}
	};

	const handleDappDisconnect = async () => {
		if (dappClient) {
			try {
				await dappClient.disconnect();
				// All state clearing is now handled by the 'disconnected' event listener
				// or by this reset function for a clean UI immediately.
				resetDappConnectionState();
				addDappLog("system", "Disconnected from wallet");
			} catch (error) {
				addDappLog("system", `Disconnect error: ${error instanceof Error ? error.message : "Unknown error"}`);
			}
		}
	};

	const handleSendDappMessage = async () => {
		if (!dappClient || !dappConnected) {
			addDappLog("system", "DApp not connected");
			return;
		}

		try {
			const message = {
				type: "message",
				content: dappMessage,
				timestamp: new Date().toISOString(),
			};

			addDappLog("sent", JSON.stringify(message, null, 2));

			await dappClient.sendRequest(message);
		} catch (error) {
			addDappLog("system", `Send error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleOtpSubmit = async () => {
		if (!otpPayload || !otpInputValue) {
			addDappLog("system", "OTP payload or input value is missing.");
			return;
		}
		try {
			addDappLog("sent", `Submitting OTP: ${otpInputValue}`);
			await otpPayload.submit(otpInputValue);
			// On success, the 'connected' event will fire, cleaning up state.
			addDappLog("system", "OTP accepted! Connecting...");
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			addDappLog("system", `OTP submission failed: ${errorMessage}`);

			// Check if this was the final attempt. If so, reset the flow.
			if (error instanceof SessionError && error.code === ErrorCode.OTP_MAX_ATTEMPTS_REACHED) {
				addDappLog("system", "Connection failed. Please start over.");
				resetDappConnectionState();
			}
			// For other errors (e.g., 'Incorrect OTP'), we do nothing, allowing the user to retry.
		}
	};

	// Wallet Functions
	const initializeWalletClient = async () => {
		try {
			setWalletStatus("Initializing...");
			addWalletLog("system", "Creating wallet client...");

			const walletKvStore = new LocalStorageKVStore("untrusted-demo-wallet-");
			const walletSessionStore = new SessionStore(walletKvStore);

			const walletTransport = await WebSocketTransport.create({
				url: RELAY_URL,
				kvstore: walletKvStore,
				websocket: typeof window !== "undefined" ? WebSocket : undefined,
			});

			const wallet = new WalletClient({
				transport: walletTransport,
				sessionstore: walletSessionStore,
				keymanager: new KeyManager(),
			});

			// Set up event listeners
			wallet.on("connected", () => {
				addWalletLog("system", "Wallet connected to dApp!");
				setWalletConnected(true);
				setWalletStatus("Connected");
			});

			wallet.on("disconnected", () => {
				addWalletLog("system", "Wallet disconnected from dApp");
				setWalletConnected(false);
				setWalletStatus("Disconnected");
			});

			wallet.on("message", (payload: unknown) => {
				addWalletLog("request", JSON.stringify(payload, null, 2));

				// If it's a request, add to pending requests
				if (payload && typeof payload === "object" && "method" in payload && "id" in payload) {
					const request = payload as { id: string; method: string; params?: unknown };
					setPendingRequests((prev) => [
						...prev,
						{
							id: request.id,
							method: request.method,
							params: request.params || {},
							timestamp: new Date(),
						},
					]);
				}
			});

			wallet.on("error", (error: Error) => {
				addWalletLog("system", `Wallet error: ${error.message}`);
			});

			wallet.on("display_otp", (otp: string, deadline: number) => {
				addWalletLog("system", `Generated OTP: ${otp}. It will expire at ${new Date(deadline).toLocaleTimeString()}`);
				setDisplayedOtp(otp);
				setOtpDeadline(deadline);
			});

			setWalletClient(wallet);

			// Try to resume existing session
			try {
				const sessions = await walletSessionStore.list();
				if (sessions.length > 0) {
					const latestSession = sessions[0];
					addWalletLog("system", `Found existing session: ${latestSession.id}, attempting to resume...`);

					await wallet.resume(latestSession.id);
					setWalletConnected(true);
					setWalletStatus("Resumed existing session");
					addWalletLog("system", "Successfully resumed existing session");
				} else {
					setWalletStatus("Ready to scan");
					addWalletLog("system", "Wallet client initialized successfully");
				}
			} catch (error) {
				setWalletStatus("Ready to scan");
				addWalletLog("system", `Wallet client initialized successfully (session resume failed: ${error instanceof Error ? error.message : "Unknown error"})`);
			}
		} catch (error) {
			addWalletLog("system", `Failed to initialize wallet: ${error instanceof Error ? error.message : "Unknown error"}`);
			setWalletStatus("Initialization failed");
		}
	};

	const handleWalletScanQR = async () => {
		if (!qrCodeData) {
			addWalletLog("system", "No QR code available to scan");
			return;
		}

		if (!walletClient) {
			addWalletLog("system", "Wallet client not initialized");
			return;
		}

		if (walletConnected) {
			addWalletLog("system", "Wallet already connected");
			return;
		}

		try {
			setWalletStatus("Connecting...");
			addWalletLog("system", "Scanning QR code and connecting...");

			// Parse QR code data and connect using session request
			if (sessionRequest) {
				await walletClient.connect({ sessionRequest });
			} else {
				addWalletLog("system", "No session request available");
				setWalletStatus("Connection failed");
			}
		} catch (error) {
			addWalletLog("system", `Scan/connect error: ${error instanceof Error ? error.message : "Unknown error"}`);
			setWalletStatus("Connection failed");
		}
	};

	const handleWalletDisconnect = async () => {
		if (walletClient) {
			try {
				await walletClient.disconnect();
				setWalletConnected(false);
				setWalletStatus("Disconnected");
				setPendingRequests([]);
				setDisplayedOtp("");
				setOtpDeadline(0);
				addWalletLog("system", "Disconnected from dApp");
			} catch (error) {
				addWalletLog("system", `Disconnect error: ${error instanceof Error ? error.message : "Unknown error"}`);
			}
		}
	};

	const handleApproveRequest = async (request: PendingRequest) => {
		if (!walletClient) return;

		try {
			const response = {
				type: "response",
				content: `Hello back from Wallet! Received: ${JSON.stringify(request.params)}`,
				timestamp: new Date().toISOString(),
			};

			// Send response back to dApp
			await walletClient.sendResponse(response);

			addWalletLog("response", `Approved request: ${JSON.stringify(response, null, 2)}`);
			setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
		} catch (error) {
			addWalletLog("system", `Approve error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleRejectRequest = async (request: PendingRequest) => {
		if (!walletClient) return;

		try {
			const errorResponse = {
				code: 4001,
				message: "User rejected the request",
			};

			await walletClient.sendResponse({
				id: request.id,
				error: errorResponse,
			});

			addWalletLog("response", `Rejected: ${request.method}`);
			setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
		} catch (error) {
			addWalletLog("system", `Reject error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	const handleSendWalletMessage = async () => {
		if (!walletClient || !walletConnected) {
			addWalletLog("system", "Wallet not connected");
			return;
		}

		try {
			const response = {
				type: "notification",
				content: walletMessage,
				timestamp: new Date().toISOString(),
			};

			addWalletLog("response", JSON.stringify(response, null, 2));

			await walletClient.sendResponse(response);
		} catch (error) {
			addWalletLog("system", `Send error: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	// Initialize clients and try to resume sessions on mount
	useEffect(() => {
		const initializeAndResume = async () => {
			await initializeDappClient();
			await initializeWalletClient();
		};

		initializeAndResume();

		// Cleanup timer on unmount
		return () => {
			clearSessionTimer();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
			<div className={`grid gap-6 ${showWalletClient ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 max-w-2xl mx-auto"}`}>
				{/* Left Column - DApp Client */}
				<div className="space-y-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<h3 className="text-xl font-bold text-gray-900 dark:text-white">DApp Client (Untrusted)</h3>
							<div className="flex items-center gap-2">
								<div className={`w-3 h-3 rounded-full ${dappConnected ? "bg-green-500" : "bg-gray-400"}`}></div>
								<span className="text-sm text-gray-600 dark:text-gray-400">{dappStatus}</span>
							</div>
						</div>

						<button
							type="button"
							onClick={() => setShowWalletClient(!showWalletClient)}
							className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
						>
							{showWalletClient ? "Hide" : "Show"} Wallet Client
						</button>
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
										disabled={!dappClient || (!!qrCodeData && !isSessionExpired)}
										className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
									>
										{dappClient ? "Connect" : "Initialize & Connect"}
									</button>
								) : (
									<button type="button" onClick={handleDappDisconnect} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors">
										Disconnect
									</button>
								)}
							</div>

							{qrCodeData && !dappConnected && !otpPayload && (
								<div className="mt-4">
									<div className="flex items-center justify-between mb-2">
										<h5 className="font-medium text-gray-900 dark:text-white">QR Code for Mobile Wallet</h5>
										{isSessionExpired ? (
											<span className="text-sm text-red-600 dark:text-red-400 font-medium">Session expired</span>
										) : (
											sessionTimeLeft > 0 && <span className="text-sm text-orange-600 dark:text-orange-400 font-medium">Expires in {formatTimeLeft(sessionTimeLeft)}</span>
										)}
									</div>
									<div className={`bg-white p-4 rounded-lg inline-block transition-opacity ${isSessionExpired ? "opacity-50" : ""}`}>
										<QRCodeDisplay data={qrCodeData} />
									</div>
									<div className="flex items-center justify-between mt-2">
										<p className="text-xs text-gray-500 dark:text-gray-400">{isSessionExpired ? "This QR code has expired." : "Scan this QR code with your mobile wallet app"}</p>
										{isSessionExpired && (
											<button type="button" onClick={handleGenerateNewQrCode} className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
												Generate New QR
											</button>
										)}
									</div>
								</div>
							)}

							{/* OTP Input Section */}
							{otpPayload && !dappConnected && (
								<div className="mt-4 border-t-2 border-dashed border-gray-300 dark:border-gray-600 pt-4">
									<h5 className="font-medium text-gray-900 dark:text-white mb-2">Enter One-Time Password</h5>
									<p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Enter the 6-digit code displayed on your wallet to confirm the connection.</p>
									<div className="space-y-3">
										<input
											type="text"
											value={otpInputValue}
											onChange={(e) => setOtpInputValue(e.target.value.replace(/\D/g, ""))}
											placeholder="123456"
											maxLength={6}
											className="w-full text-center tracking-[0.5em] font-mono text-2xl p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
										/>
										<button
											type="button"
											onClick={handleOtpSubmit}
											disabled={!otpInputValue || otpInputValue.length !== 6 || isSessionExpired}
											className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
										>
											Submit OTP
										</button>
										{sessionTimeLeft > 0 && !isSessionExpired && (
											<p className="text-sm text-center text-orange-600 dark:text-orange-400">Code expires in {formatTimeLeft(sessionTimeLeft)}</p>
										)}
										{isSessionExpired && <p className="text-sm text-center text-red-600 dark:text-red-400">OTP has expired. Please start over.</p>}
									</div>
								</div>
							)}
						</div>
					</div>

					{/* DApp Message Sending */}
					<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
						<h4 className="font-semibold mb-4 text-gray-900 dark:text-white">Send Message</h4>

						<div className="space-y-4">
							<div>
								<label htmlFor="dapp-message" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
									Message
								</label>
								<textarea
									id="dapp-message"
									value={dappMessage}
									onChange={(e) => setDappMessage(e.target.value)}
									placeholder="Hello from DApp!"
									rows={3}
									className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
									disabled={!dappConnected}
								/>
							</div>

							<button
								type="button"
								onClick={handleSendDappMessage}
								disabled={!dappConnected}
								className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
							>
								Send Message
							</button>
						</div>
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

				{/* Right Column - Wallet Client */}
				{showWalletClient && (
					<div className="space-y-6">
						<div className="flex items-center gap-3">
							<h3 className="text-xl font-bold text-gray-900 dark:text-white">Wallet Client (Untrusted)</h3>
							<div className="flex items-center gap-2">
								<div className={`w-3 h-3 rounded-full ${walletConnected ? "bg-green-500" : "bg-gray-400"}`}></div>
								<span className="text-sm text-gray-600 dark:text-gray-400">{walletStatus}</span>
							</div>
						</div>

						{/* Wallet Connection Panel */}
						<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
							<h4 className="font-semibold mb-4 text-gray-900 dark:text-white">Connection</h4>

							<div className="space-y-4">
								<div className="flex gap-3">
									{!walletConnected ? (
										<button
											type="button"
											onClick={handleWalletScanQR}
											// Disable if QR isn't available or if OTP has already been generated
											disabled={!qrCodeData || !!displayedOtp}
											className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
										>
											Scan QR Code
										</button>
									) : (
										<button type="button" onClick={handleWalletDisconnect} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors">
											Disconnect
										</button>
									)}
								</div>

								{/* OTP Display Section */}
								{displayedOtp && !walletConnected && (
									<div className="mt-4 border-t-2 border-dashed border-gray-300 dark:border-gray-600 pt-4">
										<h5 className="font-medium text-gray-900 dark:text-white mb-2">Your One-Time Password</h5>
										<p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Enter this code in the DApp to complete the connection.</p>
										<div className="bg-white dark:bg-gray-900 p-4 rounded-lg text-center">
											<p className="font-mono text-4xl tracking-[0.2em] text-gray-900 dark:text-white">{displayedOtp}</p>
										</div>
										{otpDeadline > Date.now() ? (
											<p className="text-xs text-center text-gray-500 mt-2">Expires at: {new Date(otpDeadline).toLocaleTimeString()}</p>
										) : (
											<p className="text-xs text-center text-red-500 mt-2">Expired</p>
										)}
									</div>
								)}
							</div>
						</div>

						{/* Wallet Message Sending */}
						<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
							<h4 className="font-semibold mb-4 text-gray-900 dark:text-white">Send Response</h4>

							<div className="space-y-4">
								<div>
									<label htmlFor="wallet-message" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
										Message
									</label>
									<textarea
										id="wallet-message"
										value={walletMessage}
										onChange={(e) => setWalletMessage(e.target.value)}
										placeholder="Hello from Wallet!"
										rows={3}
										className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
										disabled={!walletConnected}
									/>
								</div>

								<button
									type="button"
									onClick={handleSendWalletMessage}
									disabled={!walletConnected}
									className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors disabled:cursor-not-allowed"
								>
									Send Response
								</button>
							</div>
						</div>

						{/* Pending Requests */}
						{pendingRequests.length > 0 && (
							<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
								<h4 className="font-semibold mb-4 text-gray-900 dark:text-white">Pending Requests ({pendingRequests.length})</h4>

								<div className="space-y-3">
									{pendingRequests.map((request) => (
										<div key={request.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
											<div className="flex justify-between items-start mb-2">
												<span className="font-medium text-gray-900 dark:text-white">{request.method}</span>
												<span className="text-xs text-gray-500">{request.timestamp.toLocaleTimeString()}</span>
											</div>

											<div className="flex gap-2">
												<button
													type="button"
													onClick={() => handleApproveRequest(request)}
													className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
												>
													Approve
												</button>
												<button
													type="button"
													onClick={() => handleRejectRequest(request)}
													className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors"
												>
													Reject
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Wallet Activity Log */}
						<div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
							<h4 className="font-semibold mb-4 text-gray-900 dark:text-white">Activity Log</h4>

							<div ref={walletLogsRef} className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 h-64 overflow-y-auto">
								{walletLogs.length === 0 ? (
									<p className="text-gray-500 dark:text-gray-400 text-center text-sm">No activity yet</p>
								) : (
									<div className="space-y-2">
										{walletLogs.map((log) => (
											<div
												key={log.id}
												className={`p-2 rounded text-xs ${
													log.type === "request"
														? "bg-purple-100 dark:bg-purple-900"
														: log.type === "response"
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
				)}
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
