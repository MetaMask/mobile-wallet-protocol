// Path: context/WalletContext.tsx
import "react-native-get-random-values";
import { type Session, SessionStore } from "@metamask/mobile-wallet-protocol-core";
import Constants from "expo-constants";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { AsyncStorageKVStore } from "@/lib/AsyncStorageKVStore";
import { type GlobalActivityLogEntry, SessionManager } from "@/lib/SessionManager";

const getDevServerUrl = () => {
	const host = Constants.expoConfig?.hostUri?.split(":")[0];
	if (!host) {
		return `ws://${Platform.OS === "android" ? "10.0.2.2" : "localhost"}:8000/connection/websocket`;
	}
	return `ws://${host}:8000/connection/websocket`;
};

const RELAY_URL = getDevServerUrl();

interface WalletContextType {
	sessionManager: SessionManager | null;
	sessions: Session[];
	globalActivityLog: GlobalActivityLogEntry[];
	isInitializing: boolean;
	error: string | null;
	addLog: (entry: Omit<GlobalActivityLogEntry, "id" | "timestamp">) => void;
	otpToDisplay: string | null;
	clearOtpDisplay: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
	const [sessionManager, setSessionManager] = useState<SessionManager | null>(null);
	const [sessions, setSessions] = useState<Session[]>([]);
	const [globalActivityLog, setGlobalActivityLog] = useState<GlobalActivityLogEntry[]>([]);
	const [isInitializing, setIsInitializing] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [otpToDisplay, setOtpToDisplay] = useState<string | null>(null);

	const addLog = useCallback((entry: Omit<GlobalActivityLogEntry, "id" | "timestamp">) => {
		const newLogEntry = {
			id: Date.now().toString() + Math.random(),
			timestamp: new Date().toLocaleTimeString(),
			...entry,
		};
		setGlobalActivityLog((prev) => [newLogEntry, ...prev]);
	}, []);

	const clearOtpDisplay = useCallback(() => {
		setOtpToDisplay(null);
	}, []);

	useEffect(() => {
		let isMounted = true;
		let manager: SessionManager | null = null;

		async function initialize() {
			try {
				console.log("WalletProvider: Initializing...");
				setError(null);
				setIsInitializing(true);

				const kvstore = new AsyncStorageKVStore("wallet-");
				const sessionstore = new SessionStore(kvstore);

				manager = new SessionManager(sessionstore, RELAY_URL);
				setSessionManager(manager);

				// Listen to events from the manager
				manager.on("sessions-changed", async () => {
					if (!manager) return;
					const allSessions = await manager.getAllSessions();
					setSessions(allSessions.sort((a, b) => b.expiresAt - a.expiresAt));
				});

				manager.on("message-received", ({ sessionId, payload }) => {
					addLog({
						sessionId,
						type: "received",
						message: JSON.stringify(payload, null, 2),
					});
				});

				manager.on("system-log", ({ sessionId, message }) => {
					addLog({
						sessionId,
						type: "system",
						message,
					});
				});

				// Add this new listener
				manager.on("otp_display_request", ({ otp }: { otp: string }) => {
					setOtpToDisplay(otp);
				});

				// Add this new listener:
				manager.on("handshake_complete", () => {
					clearOtpDisplay();
				});

				await manager.resumeAllClients();

				if (isMounted) {
					console.log("WalletProvider: Initialization complete.");
				}
			} catch (e) {
				const errorMessage = e instanceof Error ? e.message : "An unknown error occurred";
				console.error("WalletProvider: Failed to initialize:", errorMessage);

				if (isMounted) {
					setError(errorMessage);
				}
			} finally {
				if (isMounted) {
					setIsInitializing(false);
				}
			}
		}

		initialize();

		return () => {
			isMounted = false;
			manager?.deleteAllClients();
		};
	}, [addLog]);

	const value = { sessionManager, sessions, globalActivityLog, isInitializing, error, addLog, otpToDisplay, clearOtpDisplay };

	return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
	const context = useContext(WalletContext);
	if (context === undefined) {
		throw new Error("useWallet must be used within a WalletProvider");
	}
	return context;
}
