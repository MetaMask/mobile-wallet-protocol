import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Button, ScrollView, StyleSheet, Text, View } from "react-native";

export default function ScannerScreen() {
	const [permission, requestPermission] = useCameraPermissions();
	const [scannedData, setScannedData] = useState<string | null>(null);
	const [isScanning, setIsScanning] = useState(true);
	const router = useRouter();

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

	const handleBarCodeScanned = ({ data }: { data: string }) => {
		if (!isScanning) return; // Prevent multiple scans

		console.log("Scanned QR Data:", data);
		setScannedData(data);
		setIsScanning(false);
	};

	const resetScanner = () => {
		setScannedData(null);
		setIsScanning(true);
	};

	const goBack = () => {
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
				onBarcodeScanned={handleBarCodeScanned}
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
});
