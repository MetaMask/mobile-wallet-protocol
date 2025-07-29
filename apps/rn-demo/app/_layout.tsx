import "react-native-get-random-values";
import "../polyfills";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { Button, Modal, StyleSheet, Text, View } from "react-native";

import { useWallet, WalletProvider } from "@/context/WalletContext";

function AppLayout() {
	const { otpToDisplay, clearOtpDisplay } = useWallet();

	return (
		<>
			<Stack>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="scanner" options={{ presentation: "modal", title: "Scan QR Code" }} />
				<Stack.Screen name="+not-found" />
			</Stack>
			<OtpModal visible={!!otpToDisplay} otp={otpToDisplay} onClose={clearOtpDisplay} />
		</>
	);
}

export default function RootLayout() {
	return (
		<WalletProvider>
			<AppLayout />
			<StatusBar style="auto" />
		</WalletProvider>
	);
}

function OtpModal({ visible, otp, onClose }: { visible: boolean; otp: string | null; onClose: () => void }) {
	return (
		<Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
			<View style={styles.modalOverlay}>
				<View style={styles.modalContent}>
					<Text style={styles.modalTitle}>Enter this code in the dApp</Text>
					<Text style={styles.modalDescription}>To complete the connection, please enter the following One-Time Password in the application you are connecting to.</Text>
					<View style={styles.otpContainer}>
						<Text style={styles.otpText}>{otp}</Text>
					</View>
					<Button title="Done" onPress={onClose} />
				</View>
			</View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	modalOverlay: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "rgba(0, 0, 0, 0.6)",
	},
	modalContent: {
		width: "90%",
		maxWidth: 400,
		backgroundColor: "white",
		borderRadius: 12,
		padding: 24,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.25,
		shadowRadius: 4,
		elevation: 5,
	},
	modalTitle: {
		fontSize: 22,
		fontWeight: "bold",
		marginBottom: 12,
		textAlign: "center",
	},
	modalDescription: {
		fontSize: 14,
		color: "#666",
		textAlign: "center",
		marginBottom: 24,
	},
	otpContainer: {
		backgroundColor: "#f0f0f0",
		paddingVertical: 16,
		paddingHorizontal: 32,
		borderRadius: 8,
		marginBottom: 24,
		borderWidth: 1,
		borderColor: "#e0e0e0",
	},
	otpText: {
		fontSize: 40,
		fontWeight: "bold",
		fontFamily: "monospace",
		letterSpacing: 8,
		color: "#111",
	},
});
