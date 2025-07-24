// Path: app/(tabs)/sessions/[sessionId].tsx
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Button, FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { useWallet } from "@/context/WalletContext";

export default function SessionDetailScreen() {
	const router = useRouter();
	const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
	const { sessionManager, sessions, globalActivityLog, addLog } = useWallet();
	const [responseText, setResponseText] = useState("");

	const session = useMemo(() => sessions.find((s) => s.id === sessionId), [sessions, sessionId]);

	const sessionLog = useMemo(() => {
		return globalActivityLog.filter((log) => log.sessionId === sessionId);
	}, [globalActivityLog, sessionId]);

	useEffect(() => {
		if (!session) {
			if (router.canGoBack()) {
				router.back();
			}
		}
	}, [session, router]);

	if (!sessionManager) {
		return <ActivityIndicator />;
	}

	if (!session) {
		// This can happen if the session is deleted and the component re-renders.
		// The useEffect above will handle navigation, but we can show a message briefly.
		return (
			<View style={styles.container}>
				<Stack.Screen
					options={{
						headerLeft: () => <Button onPress={() => router.replace("/sessions")} title="< Sessions" />,
					}}
				/>
				<Text>Session not found. Navigating back...</Text>
			</View>
		);
	}

	const handleDisconnect = () => {
		sessionManager.deleteClient(session.id);
	};

	const handleSendResponse = async () => {
		const client = sessionManager.getClient(session.id);
		if (!client || !responseText) return;

		try {
			// biome-ignore lint/suspicious/noImplicitAnyLet: demo code
			let payload;
			let payloadString: string;
			try {
				payload = JSON.parse(responseText);
				payloadString = JSON.stringify(payload, null, 2);
			} catch {
				payload = { message: responseText };
				payloadString = responseText;
			}
			await client.sendResponse(payload);
			addLog({ sessionId: session.id, type: "sent", message: payloadString });
			setResponseText("");
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : "Unknown error";
			addLog({ sessionId: session.id, type: "error", message: `Send failed: ${errorMessage}` });
			console.error("Failed to send response:", e);
		}
	};

	return (
		<View style={styles.container}>
			<Stack.Screen
				options={{
					title: `Session: ${sessionId?.substring(0, 8)}...`,
					// Add a custom back button that always works
					headerLeft: () => <Button onPress={() => router.replace("/sessions")} title="< Sessions" />,
				}}
			/>
			<Text style={styles.title}>Session Details</Text>
			<Text>ID: {session.id}</Text>
			<Text>Expires: {new Date(session.expiresAt).toLocaleString()}</Text>
			<View style={styles.separator} />

			<Button title="Disconnect This Session" color="red" onPress={handleDisconnect} />

			<View style={styles.sendResponseSection}>
				<Text style={styles.subtitle}>Send Response</Text>
				<TextInput style={styles.input} multiline value={responseText} onChangeText={setResponseText} placeholder="Enter JSON or message" />
				<Button title="Send" onPress={handleSendResponse} disabled={!responseText} />
			</View>

			<View style={styles.logSection}>
				<Text style={styles.subtitle}>Activity Log for this Session</Text>
				<FlatList
					data={sessionLog}
					keyExtractor={(item) => item.id}
					renderItem={({ item }) => (
						<View style={styles.logItem}>
							<Text style={styles.logTimestamp}>{item.timestamp}</Text>
							<Text style={styles.logMessage}>{`[${item.type.toUpperCase()}]: ${item.message}`}</Text>
						</View>
					)}
					style={styles.list}
					inverted
				/>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		padding: 16,
	},
	title: {
		fontSize: 24,
		fontWeight: "bold",
		marginBottom: 8,
	},
	subtitle: {
		fontSize: 18,
		fontWeight: "bold",
		marginBottom: 8,
	},
	separator: {
		marginVertical: 16,
		height: 1,
		width: "100%",
		backgroundColor: "#eee",
	},
	sendResponseSection: {
		// Not flexible, takes up its own space
	},
	logSection: {
		flex: 1, // Takes up remaining space
		width: "100%",
		marginTop: 16,
	},
	input: {
		borderWidth: 1,
		borderColor: "#ccc",
		padding: 10,
		marginBottom: 8,
		borderRadius: 4,
		minHeight: 80,
	},
	list: {
		width: "100%",
		flex: 1,
		borderWidth: 1,
		borderColor: "#ccc",
		borderRadius: 4,
	},
	logItem: {
		padding: 10,
		// Since the list is inverted, the "bottom" border is now at the top of the item.
		borderTopWidth: 1,
		borderTopColor: "#eee",
		borderBottomWidth: 0,
	},
	logTimestamp: {
		fontSize: 12,
		color: "#666",
	},
	logMessage: {
		fontSize: 14,
		fontFamily: "monospace",
	},
}); 