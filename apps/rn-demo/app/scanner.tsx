import "react-native-get-random-values";

import { KeyManager, type SessionRequest, SessionStore, WebSocketTransport } from "@metamask/mobile-wallet-protocol-core";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, View } from "react-native";

import { AsyncStorageKVStore } from "../lib/AsyncStorageKVStore";

const RELAY_URL = "wss://relay.mobile.dev.metamask-institutional.io/";

export default function ScannerScreen() {
	const [permission, requestPermission] = useCameraPermissions();
	const [scannedData, setScannedData] = useState<string | null>(null);
	const [isScanning, setIsScanning] = useState(true);
	const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
	const [isConnected, setIsConnected] = useState(false);
	const hasScanned = useRef(false);
	const router = useRouter();

	useEffect(() => {
		let client: WalletClient | null = null;
		const initializeClient = async () => {
			console.log("Initializing WalletClient...");

			const kvstore = new AsyncStorageKVStore();
			const sessionstore = new SessionStore(kvstore);
			const transport = await WebSocketTransport.create({ url: RELAY_URL, kvstore });
			client = new WalletClient({ sessionstore, transport });

			client.on("connected", () => {
				console.log("Client connected");
				setIsConnected(true);
			});

			client.on("disconnected", () => {
				console.log("Client disconnected");
				setIsConnected(false);
			});

			setWalletClient(client);
			console.log("WalletClient initialized.");
		};

		initializeClient();

		return () => {
			console.log("Scanner screen unmounting, disconnecting client...");
			client?.disconnect();
		};
	}, []);

	if (!permission) {
		// Camera permissions are still loading.
		return <View />;
	}

	if (!permission.granted) {
		// Camera permissions are not granted yet.
		return (
			<View style={styles.container}>
				<Text style={{ textAlign: "center" }}>We need your permission to show the camera</Text>
				<Button onPress={requestPermission} title="grant permission" />
			</View>
		);
	}

	const handleBarCodeScanned = async ({ data }: { data: string }) => {
		if (hasScanned.current || !walletClient) return; // Use ref instead

		console.log("Scanned QR Data:", data);
		hasScanned.current = true; // Update ref synchronously
		setScannedData(data);
		setIsScanning(false);

		try {
			console.log("Parsing session request...");
			const sessionRequest = JSON.parse(data) as SessionRequest;
			console.log("Session request parsed:", sessionRequest);

			console.log("Connecting to session...");
			await walletClient.connect({ sessionRequest });
			console.log("Session established.");
		} catch (error) {
			console.error("Failed to connect session:", error);
		}
	};

	const resetScanner = () => {
		setScannedData(null);
		hasScanned.current = false;
		setIsScanning(true);
	};

	const goBack = () => {
		walletClient?.disconnect();
		router.back();
	};

	if (scannedData) {
		// Show scanned data
		return (
			<View style={styles.container}>
				<Text style={styles.title}>QR Code Scanned!</Text>
				<ScrollView style={styles.dataContainer}>
					<Text style={styles.dataText}>{scannedData}</Text>
				</ScrollView>

				{isConnected && <Text style={styles.successText}>Session Connected!</Text>}

				<View style={styles.buttonContainer}>
					<Button title="Scan Another" onPress={resetScanner} />
					<Button title="Go Back" onPress={goBack} />
				</View>
			</View>
		);
	}

	return (
		<View style={styles.container}>
			<CameraView
				onBarcodeScanned={isScanning ? handleBarCodeScanned : undefined}
				barcodeScannerSettings={{
					barcodeTypes: ["qr"],
				}}
				style={StyleSheet.absoluteFillObject}
			/>
			<View style={styles.overlay}>
				<Text style={styles.instructionText}>Point camera at QR code</Text>
				<Button title="Cancel" onPress={goBack} />
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
	},
	title: {
		fontSize: 24,
		fontWeight: "bold",
		textAlign: "center",
		marginBottom: 20,
		paddingTop: 50,
	},
	dataContainer: {
		flex: 1,
		backgroundColor: "#f0f0f0",
		margin: 20,
		padding: 15,
		borderRadius: 8,
	},
	dataText: {
		fontSize: 14,
		fontFamily: "monospace",
	},
	buttonContainer: {
		flexDirection: "row",
		justifyContent: "space-around",
		padding: 20,
		paddingBottom: 50,
	},
	overlay: {
		position: "absolute",
		top: 100,
		left: 0,
		right: 0,
		alignItems: "center",
		gap: 20,
	},
	instructionText: {
		color: "white",
		fontSize: 18,
		backgroundColor: "rgba(0,0,0,0.6)",
		padding: 10,
		borderRadius: 5,
	},
	successText: {
		color: "green",
		fontSize: 18,
		textAlign: "center",
		marginVertical: 10,
	},
});
