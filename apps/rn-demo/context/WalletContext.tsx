import "react-native-get-random-values";
import { SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import Constants from "expo-constants"; // <-- Import expo-constants
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { AsyncStorageKVStore } from "@/lib/AsyncStorageKVStore";

// Dynamically determine the WebSocket URL for the local development server.
// This allows connecting from both physical devices and emulators.
const getDevServerUrl = () => {
	// `hostUri` is set by Expo and includes the IP of the dev machine.
	const host = Constants.expoConfig?.hostUri?.split(":")[0];

	if (!host) {
		// Fallback for environments where hostUri is not available.
		// On Android emulators, 10.0.2.2 is the host machine.
		// On iOS simulators, localhost is the host machine.
		return `ws://${Platform.OS === "android" ? "10.0.2.2" : "localhost"}:8000/connection/websocket`;
	}

	return `ws://${host}:8000/connection/websocket`;
};

const RELAY_URL = getDevServerUrl();

interface WalletContextType {
	client: WalletClient | null;
	isInitializing: boolean;
	error: string | null;
	connected: boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
	const [client, setClient] = useState<WalletClient | null>(null);
	const [isInitializing, setIsInitializing] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);

	useEffect(() => {
		let isMounted = true;

		async function initializeClient() {
			try {
				console.log("WalletProvider: Initializing WalletClient...");
				console.log(`WalletProvider: Using WebSocket URL: ${RELAY_URL}`);
				console.log(`WalletProvider: Platform: ${Platform.OS}`);
				console.log(`WalletProvider: Expo hostUri: ${Constants.expoConfig?.hostUri}`);
				setError(null);
				setIsInitializing(true);

				const kvstore = new AsyncStorageKVStore("wallet-");
				console.log("WalletProvider: AsyncStorageKVStore created.");

				const sessionstore = new SessionStore(kvstore);
				console.log("WalletProvider: SessionStore created.");

				const transport = await WebSocketTransport.create({
					url: RELAY_URL,
					kvstore,
					websocket: WebSocket,
				});
				console.log("WalletProvider: WebSocketTransport created.");

				const walletClient = new WalletClient({
					transport,
					sessionstore,
				});
				console.log("WalletProvider: WalletClient created.");

				walletClient.on("error", (err) => {
					console.error("WalletProvider: WalletClient Error:", err);
					setError(err.message);
				});

				walletClient.on("connected", () => {
					console.log("WalletProvider: Wallet connected");
					setConnected(true);
				});

				walletClient.on("disconnected", () => {
					console.log("WalletProvider: Wallet disconnected");
					setConnected(false);
				});

				if (isMounted) {
					setClient(walletClient);
					console.log("WalletProvider: WalletClient initialized successfully.");

					// Attempt to resume the most recent session
					const sessions = await sessionstore.list();
					console.log(`WalletProvider: Found ${sessions.length} sessions.`);
					if (sessions.length > 0) {
						const latestSession = sessions[0];
						console.log(`WalletProvider: Attempting to resume session ${latestSession.id}...`);
						try {
							await walletClient.resume(latestSession.id);
							console.log(`WalletProvider: Session ${latestSession.id} resumed successfully.`);
						} catch (resumeError) {
							console.error("WalletProvider: Failed to resume session:", resumeError);
							setError((resumeError as Error).message);
						}
					}
				}
			} catch (e) {
				const errorMessage = e instanceof Error ? e.message : "An unknown error occurred";
				console.error("WalletProvider: Failed to initialize WalletClient:", errorMessage);
				if (isMounted) {
					setError(errorMessage);
				}
			} finally {
				if (isMounted) {
					setIsInitializing(false);
				}
			}
		}

		initializeClient();

		return () => {
			isMounted = false;
			console.log("WalletProvider: unmounting. Client will be cleaned up if necessary.");
		};
	}, []);

	const value = { client, isInitializing, error, connected };

	return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
	const context = useContext(WalletContext);
	if (context === undefined) {
		throw new Error("useWallet must be used within a WalletProvider");
	}
	return context;
}
