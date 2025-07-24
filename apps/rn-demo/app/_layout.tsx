import "react-native-get-random-values";
import "../polyfills";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { WalletProvider } from "@/context/WalletContext";

export default function RootLayout() {
	return (
		<WalletProvider>
			<Stack>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="scanner" options={{ presentation: "modal", title: "Scan QR Code" }} />
				<Stack.Screen name="+not-found" />
			</Stack>
			<StatusBar style="auto" />
		</WalletProvider>
	);
}
