// Path: app/(tabs)/home.tsx
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { useWallet } from "@/context/WalletContext";

export default function HomeScreen() {
	const { isInitializing, error, globalActivityLog } = useWallet();
	const router = useRouter();

	if (isInitializing) {
		return (
			<View style={styles.container}>
				<ActivityIndicator size="large" />
				<Text>Initializing & Resuming Sessions...</Text>
			</View>
		);
	}

	if (error) {
		return (
			<View style={styles.container}>
				<Text style={{ color: "red" }}>Error: {error}</Text>
			</View>
		);
	}

	return (
		<View style={styles.container}>
			{globalActivityLog.length === 0 ? (
				<Text style={styles.emptyText}>No activity yet. Scan a QR code to connect to a dApp.</Text>
			) : (
				<FlatList
					data={globalActivityLog}
					keyExtractor={(item) => item.id}
					renderItem={({ item }) => (
						// Wrap the item in a Pressable to allow navigation
						<Pressable onPress={() => router.push(`/sessions/${item.sessionId}`)}>
							<View style={styles.logItem}>
								<Text style={styles.logTimestamp}>
									{item.timestamp} - Session: {item.sessionId.substring(0, 8)}...
								</Text>
								<Text style={styles.logMessage}>{`[${item.type.toUpperCase()}]: ${item.message}`}</Text>
							</View>
						</Pressable>
					)}
					style={styles.list}
					contentContainerStyle={styles.listContent}
				/>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		padding: 10,
	},
	emptyText: {
		fontSize: 16,
		color: "gray",
		textAlign: "center",
	},
	list: {
		width: "100%",
	},
	listContent: {
		paddingBottom: 20,
	},
	logItem: {
		backgroundColor: "#f0f0f0",
		padding: 10,
		borderRadius: 5,
		marginBottom: 8,
		width: "100%",
	},
	logTimestamp: {
		fontSize: 12,
		color: "#666",
		marginBottom: 4,
	},
	logMessage: {
		fontSize: 14,
		fontFamily: "monospace",
	},
});
