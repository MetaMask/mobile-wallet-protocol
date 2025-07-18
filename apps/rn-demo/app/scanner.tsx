import type { SessionRequest } from "@metamask/mobile-wallet-protocol-core";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";

import { Button, StyleSheet, Text, View } from "react-native";

import { walletService } from "@/services/WalletService";

export default function ScannerScreen() {
	const [permission, requestPermission] = useCameraPermissions();
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
		try {
			console.log("Scanned QR Data:", data);
			const sessionRequest: SessionRequest = JSON.parse(data);

			// A simple validation for the parsed data
			if (sessionRequest.id && sessionRequest.channel && sessionRequest.publicKeyB64) {
				walletService.connect(sessionRequest);
				router.back();
			} else {
				alert("Invalid QR Code. Please scan a valid Mobile Wallet Protocol QR code.");
			}
		} catch (e) {
			console.error("Failed to parse QR code", e);
			alert("Failed to parse QR code. Is it a valid JSON?");
		}
	};

	return (
		<View style={styles.container}>
			<CameraView
				onBarcodeScanned={handleBarCodeScanned}
				barcodeScannerSettings={{
					barcodeTypes: ["qr"],
				}}
				style={StyleSheet.absoluteFillObject}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
	},
});
