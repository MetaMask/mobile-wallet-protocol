// Path: app/scanner.tsx
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
	const { sessionManager } = useWallet();

	if (!permission) {
		return <View />;
	}

	if (!permission.granted) {
		return (
			<View style={styles.container}>
				<Text style={{ textAlign: "center" }}>We need your permission to show the camera</Text>
				<Button onPress={requestPermission} title="grant permission" />
			</View>
		);
	}

	const handleBarCodeScanned = async ({ data }: { data: string }) => {
		if (hasScanned.current || !sessionManager || isConnecting) {
			return;
		}

		hasScanned.current = true;
		setIsScanning(false);
		setIsConnecting(true);
		setScanError(null);

		try {
			const sessionRequest: SessionRequest = JSON.parse(data);
			// Use the sessionManager to create the new session
			await sessionManager.createClientForSession(sessionRequest);
			router.back();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			setScanError(errorMessage);
			hasScanned.current = false; // Allow rescan on error
		} finally {
			setIsConnecting(false);
		}
	};

	const resetScanner = () => {
		setScanError(null);
		hasScanned.current = false;
		setIsScanning(true);
	};

	const goBack = () => {
		router.back();
	};

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
