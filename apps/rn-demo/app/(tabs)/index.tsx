import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Button, FlatList, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useWallet } from "@/context/WalletContext";

type LogEntry = {
	id: string;
	type: "sent" | "received" | "error";
	message: string;
	timestamp: string;
};

type PendingRequest = {
	id: string;
	method: string;
	params: unknown;
	timestamp: Date;
};

export default function HomeScreen() {
	const { client, isInitializing, error, connected } = useWallet();
	const router = useRouter();

	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
	const [responseText, setResponseText] = useState("");
	const logsRef = useRef<ScrollView>(null);

	useEffect(() => {
		if (!client) {
			console.log("HomeScreen: client is not ready.");
			return;
		}
		console.log("HomeScreen: client is ready, setting up event listeners.");

		const handleMessage = (payload: unknown) => {
			console.log("HomeScreen: received message", payload);
			addLog("received", JSON.stringify(payload));
			if (payload && typeof payload === "object" && "id" in payload && "method" in payload && "jsonrpc" in payload) {
				const req = payload as { id: string; method: string; params?: unknown };
				setPendingRequests((prev) => {
					console.log(`HomeScreen: adding pending request for method ${req.method}`);
					return [...prev, { id: req.id, method: req.method, params: req.params || [], timestamp: new Date() }];
				});
			}
		};

		const handleError = (err: Error) => {
			console.error("HomeScreen: received error", err);
			addLog("error", err.message);
		};

		client.on("message", handleMessage);
		client.on("error", handleError);

		return () => {
			console.log("HomeScreen: cleaning up event listeners.");
			client.off("message", handleMessage);
			client.off("error", handleError);
		};
	}, [client]);

	useEffect(() => {
		logsRef.current?.scrollToEnd({ animated: true });
	}, [logs]);

	const addLog = (type: LogEntry["type"], message: string) => {
		console.log(`HomeScreen: adding log - type: ${type}, message: ${message.substring(0, 100)}...`);
		setLogs((prev) => [...prev, { id: Date.now().toString(), type, message, timestamp: new Date().toLocaleTimeString() }]);
	};

	const handleScanPress = () => {
		console.log("HomeScreen: navigating to scanner.");
		router.push("/scanner");
	};

	const handleDisconnect = async () => {
		if (client) {
			console.log("HomeScreen: disconnecting client.");
			await client.disconnect();
			setPendingRequests([]);
			setLogs([]);
			console.log("HomeScreen: client disconnected and state cleared.");
		}
	};

	const handleSendResponse = async () => {
		if (!client) return;
		console.log("HomeScreen: sending response:", responseText);
		try {
			let payload;
			try {
				payload = JSON.parse(responseText);
			} catch {
				payload = { message: responseText };
			}
			await client.sendResponse(payload);
			addLog("sent", JSON.stringify(payload));
			setResponseText("");
			console.log("HomeScreen: response sent successfully.");
		} catch (e) {
			console.error("HomeScreen: failed to send response", e);
			addLog("error", e instanceof Error ? e.message : String(e));
		}
	};

	const handleApprove = async (req: PendingRequest) => {
		if (!client) return;
		console.log(`HomeScreen: approving request ${req.id} (${req.method})`);
		try {
			await client.sendResponse({ jsonrpc: "2.0", id: req.id, result: "approved" });
			addLog("sent", `Approved ${req.method}`);
			setPendingRequests((prev) => prev.filter((p) => p.id !== req.id));
			console.log(`HomeScreen: request ${req.id} approved successfully.`);
		} catch (e) {
			console.error(`HomeScreen: failed to approve request ${req.id}`, e);
			addLog("error", e instanceof Error ? e.message : String(e));
		}
	};

	const handleReject = async (req: PendingRequest) => {
		if (!client) return;
		console.log(`HomeScreen: rejecting request ${req.id} (${req.method})`);
		try {
			await client.sendResponse({ jsonrpc: "2.0", id: req.id, error: { code: 4001, message: "User rejected" } });
			addLog("sent", `Rejected ${req.method}`);
			setPendingRequests((prev) => prev.filter((p) => p.id !== req.id));
			console.log(`HomeScreen: request ${req.id} rejected successfully.`);
		} catch (e) {
			console.error(`HomeScreen: failed to reject request ${req.id}`, e);
			addLog("error", e instanceof Error ? e.message : String(e));
		}
	};

	if (isInitializing) {
		console.log("HomeScreen: rendering - initializing");
		return (
			<ThemedView style={styles.container}>
				<ActivityIndicator size="large" />
				<ThemedText>Initializing...</ThemedText>
			</ThemedView>
		);
	}

	if (error) {
		console.log(`HomeScreen: rendering - error: ${error}`);
		return (
			<ThemedView style={styles.container}>
				<ThemedText style={{ color: "red" }}>Error: {error}</ThemedText>
			</ThemedView>
		);
	}

	console.log(`HomeScreen: rendering - connected: ${connected}`);
	return (
		<ThemedView style={styles.container}>
			<ThemedText type="title">Wallet Demo</ThemedText>

			{connected ? (
				<ThemedView style={styles.connectedContainer}>
					<ThemedText type="subtitle" style={{ color: "green" }}>
						Connected
					</ThemedText>
					<Button title="Disconnect" onPress={handleDisconnect} color="red" />

					{/* Pending Requests */}
					{pendingRequests.length > 0 && (
						<ThemedView style={styles.section}>
							<ThemedText type="subtitle">Pending Requests ({pendingRequests.length})</ThemedText>
							<FlatList
								data={pendingRequests}
								keyExtractor={(item) => item.id}
								renderItem={({ item }) => (
									<ThemedView style={styles.requestItem}>
										<ThemedText>{item.method}</ThemedText>
										<ThemedText style={styles.timestamp}>{item.timestamp.toLocaleTimeString()}</ThemedText>
										<View style={styles.buttons}>
											<Button title="Approve" onPress={() => handleApprove(item)} color="green" />
											<Button title="Reject" onPress={() => handleReject(item)} color="red" />
										</View>
									</ThemedView>
								)}
								style={styles.list}
							/>
						</ThemedView>
					)}

					{/* Send Response */}
					<ThemedView style={styles.section}>
						<ThemedText type="subtitle">Send Response</ThemedText>
						<TextInput style={styles.input} multiline value={responseText} onChangeText={setResponseText} placeholder="Enter JSON or message" />
						<Button title="Send" onPress={handleSendResponse} disabled={!responseText} />
					</ThemedView>

					{/* Activity Log */}
					<ThemedView style={styles.section}>
						<ThemedText type="subtitle">Activity Log</ThemedText>
						<ScrollView ref={logsRef} style={styles.logs}>
							{logs.map((log) => (
								<ThemedView key={log.id} style={[styles.logItem, log.type === "sent" ? styles.sentLog : log.type === "received" ? styles.receivedLog : styles.errorLog]}>
									<ThemedText>{`${log.timestamp} [${log.type.toUpperCase()}]: ${log.message}`}</ThemedText>
								</ThemedView>
							))}
						</ScrollView>
					</ThemedView>
				</ThemedView>
			) : (
				<Button title="Scan QR Code to Connect" onPress={handleScanPress} disabled={!client} />
			)}
		</ThemedView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		padding: 20,
		justifyContent: "center",
	},
	connectedContainer: {
		flex: 1,
		width: "100%",
	},
	section: {
		marginVertical: 16,
	},
	list: {
		maxHeight: 150,
	},
	requestItem: {
		padding: 10,
		borderBottomWidth: 1,
		borderBottomColor: "#ccc",
	},
	timestamp: {
		fontSize: 12,
		color: "gray",
	},
	buttons: {
		flexDirection: "row",
		justifyContent: "space-around",
		marginTop: 8,
	},
	input: {
		borderWidth: 1,
		borderColor: "#ccc",
		padding: 10,
		marginBottom: 8,
		borderRadius: 4,
		minHeight: 80,
	},
	logs: {
		maxHeight: 200,
		borderWidth: 1,
		borderColor: "#ccc",
		borderRadius: 4,
		padding: 8,
	},
	logItem: {
		padding: 8,
		marginBottom: 4,
		borderRadius: 4,
	},
	sentLog: { backgroundColor: "#d1e7dd" },
	receivedLog: { backgroundColor: "#cff4fc" },
	errorLog: { backgroundColor: "#f8d7da" },
});
