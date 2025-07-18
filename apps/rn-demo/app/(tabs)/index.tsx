import { useRouter } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";

export default function HomeScreen() {
	const [scannedData, setScannedData] = useState<string | null>(null);
	const router = useRouter();

	const handleScanPress = () => {
		router.push("/scanner" as any);
	};

	const clearData = () => {
		setScannedData(null);
	};

	return (
		<ThemedView style={styles.container}>
			<ThemedText type="title">Wallet Demo</ThemedText>

			<ThemedText type="subtitle">Simple QR Code Scanner</ThemedText>

			<Button title="Scan QR Code" onPress={handleScanPress} />

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
