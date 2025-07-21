import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Button, StyleSheet } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useWallet } from "@/context/WalletContext";

export default function HomeScreen() {
	const [scannedData, setScannedData] = useState<string | null>(null);
	const router = useRouter();
	const { client, isInitializing, error } = useWallet();

	const handleScanPress = () => {
		router.push("/scanner" as any);
	};

	const clearData = () => {
		setScannedData(null);
	};

	return (
		<ThemedView style={styles.container}>
			<ThemedText type="title">Wallet Demo</ThemedText>

			{/* Wallet Client Status */}
			<ThemedView style={styles.statusContainer}>
				<ThemedText type="subtitle">Client Status</ThemedText>
				{isInitializing ? (
					<ActivityIndicator size="small" />
				) : error ? (
					<ThemedText style={{ color: "red" }}>Error: {error}</ThemedText>
				) : client ? (
					<ThemedText style={{ color: "green" }}>Client Initialized</ThemedText>
				) : (
					<ThemedText style={{ color: "orange" }}>Client Not Initialized</ThemedText>
				)}
			</ThemedView>

			<Button title="Scan QR Code" onPress={handleScanPress} disabled={!client} />

			{scannedData && (
				<ThemedView style={styles.dataContainer}>
					<ThemedText type="subtitle">Scanned Data:</ThemedText>
					<ThemedText style={styles.dataText}>{scannedData}</ThemedText>
					<Button title="Clear" onPress={clearData} />
				</ThemedView>
			)}
		</ThemedView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 32,
		padding: 20,
	},
	statusContainer: {
		alignItems: "center",
		padding: 10,
		borderRadius: 8,
		backgroundColor: "#f0f0f0",
	},
	dataContainer: {
		alignItems: "center",
		padding: 20,
		borderRadius: 8,
		backgroundColor: "#f0f0f0",
		maxWidth: "90%",
	},
	dataText: {
		marginTop: 8,
		fontFamily: "SpaceMono",
		textAlign: "center",
		fontSize: 12,
	},
});
