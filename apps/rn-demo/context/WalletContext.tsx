import { SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { AsyncStorageKVStore } from "@/lib/AsyncStorageKVStore";

const RELAY_URL = "ws://localhost:8000/connection/websocket";

interface WalletContextType {
	client: WalletClient | null;
	isInitializing: boolean;
	error: string | null;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
	const [client, setClient] = useState<WalletClient | null>(null);
	const [isInitializing, setIsInitializing] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;

		async function initializeClient() {
			try {
				console.log("Initializing WalletClient...");
				setError(null);
				setIsInitializing(true);

				const kvstore = new AsyncStorageKVStore("wallet-");
				const sessionstore = new SessionStore(kvstore);
				const transport = await WebSocketTransport.create({
					url: RELAY_URL,
					kvstore,
				});

				const walletClient = new WalletClient({
					transport,
					sessionstore,
				});

				walletClient.on("error", (err) => {
					console.error("WalletClient Error:", err);
					setError(err.message);
				});

				if (isMounted) {
					setClient(walletClient);
					console.log("WalletClient initialized successfully.");
				}
			} catch (e) {
				const errorMessage = e instanceof Error ? e.message : "An unknown error occurred";
				console.error("Failed to initialize WalletClient:", errorMessage);
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
			// You can add client cleanup logic here if needed in the future, e.g., client?.disconnect()
		};
	}, []);

	const value = { client, isInitializing, error };

	return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
	const context = useContext(WalletContext);
	if (context === undefined) {
		throw new Error("useWallet must be used within a WalletProvider");
	}
	return context;
}
