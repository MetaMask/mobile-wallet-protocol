import "react-native-get-random-values";

import type { SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";

import { useWallet } from "@/context/WalletContext";

export default function ScannerScreen() {
	const [permission, requestPermission] = useCameraPermissions();
	const [isScanning, setIsScanning] = useState(true);
	const [scanError, setScanError] = useState<string | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	const hasScanned = useRef(false);
	const router = useRouter();
	const { client } = useWallet();

	if (!permission) {
		console.log("ScannerScreen: camera permission is loading.");
		return <View />;
	}

	if (!permission.granted) {
		console.log("ScannerScreen: camera permission not granted.");
		return (
			<View style={styles.container}>
				<Text style={{ textAlign: "center" }}>We need your permission to show the camera</Text>
				<Button onPress={requestPermission} title="grant permission" />
			</View>
		);
	}

	const handleBarCodeScanned = async ({ data }: { data: string }) => {
		if (hasScanned.current || !client || isConnecting) {
			console.log("ScannerScreen: scan ignored (already scanned, no client, or connecting).");
			return;
		}

		console.log("ScannerScreen: QR code scanned.", data);
		hasScanned.current = true;
		setIsScanning(false);
		setIsConnecting(true);
		setScanError(null);

		try {
			console.log("ScannerScreen: parsing session request...");
			const sessionRequest: SessionRequest = JSON.parse(data);
			console.log("ScannerScreen: connecting client with session request...", sessionRequest);
			await client.connect({ sessionRequest });
			console.log("ScannerScreen: client connected successfully, navigating back.");
			router.back();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			console.error("ScannerScreen: failed to connect.", errorMessage);
			setScanError(errorMessage);
			hasScanned.current = false; // Allow rescan on error
		} finally {
			console.log("ScannerScreen: finished connection attempt.");
			setIsConnecting(false);
		}
	};

	const resetScanner = () => {
		console.log("ScannerScreen: resetting scanner.");
		setScanError(null);
		hasScanned.current = false;
		setIsScanning(true);
	};

	const goBack = () => {
		console.log("ScannerScreen: navigating back.");
		router.back();
	};

	console.log("ScannerScreen: rendering.");
	return (
		<View style={styles.container}>
			<CameraView onBarcodeScanned={isScanning ? handleBarCodeScanned : undefined} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} style={StyleSheet.absoluteFillObject} />
			<View style={styles.overlay}>
				<Text style={styles.instructionText}>Point camera at QR code</Text>
				<Button title="Cancel" onPress={goBack} />
			</View>

			{isConnecting && (
				<View style={styles.loadingOverlay}>
					<ActivityIndicator size="large" color="white" />
					<Text style={styles.loadingText}>Connecting...</Text>
				</View>
			)}

			{scanError && (
				<View style={styles.errorOverlay}>
					<Text style={styles.errorText}>Error: {scanError}</Text>
					<Button title="Retry" onPress={resetScanner} />
					<Button title="Cancel" onPress={goBack} />
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
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
	loadingOverlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "rgba(0,0,0,0.7)",
		justifyContent: "center",
		alignItems: "center",
	},
	loadingText: {
		color: "white",
		marginTop: 10,
		fontSize: 16,
	},
	errorOverlay: {
		position: "absolute",
		bottom: 100,
		left: 20,
		right: 20,
		backgroundColor: "rgba(255,0,0,0.9)",
		padding: 20,
		borderRadius: 10,
		alignItems: "center",
		gap: 10,
	},
	errorText: {
		color: "white",
		fontSize: 16,
		textAlign: "center",
	},
});
