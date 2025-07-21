// app/(tabs)/debug.tsx
import "react-native-get-random-values";

import { KeyManager } from "@metamask/mobile-wallet-protocol-core";
import { Buffer } from "buffer";
import { useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";

// Ensure Buffer is polyfilled (if not global)
if (!globalThis.Buffer) {
	globalThis.Buffer = Buffer;
}

export default function DebugScreen() {
	const [result, setResult] = useState<string>("Press button to test KeyManager");
	const [error, setError] = useState<string | null>(null);

	const runTest = () => {
		setError(null);
		setResult("Running test...");

		try {
			console.log("Initializing KeyManager...");
			const keyManager = new KeyManager();

			console.log("Generating key pair...");
			const keyPair = keyManager.generateKeyPair();
			console.log("Key pair generated successfully.");

			const privateKeyHex = Buffer.from(keyPair.privateKey).toString("hex");
			const publicKeyHex = Buffer.from(keyPair.publicKey).toString("hex");

			console.log("Private Key (hex):", privateKeyHex);
			console.log("Public Key (hex):", publicKeyHex);

			setResult(`Success! Key pair generated.\nPrivate key length: ${keyPair.privateKey.length}\nPublic key length: ${keyPair.publicKey.length}`);
		} catch (err) {
			console.error("Test failed:", err);
			setError(err instanceof Error ? err.message : "Unknown error");
			setResult("Test failed");
		}
	};

	return (
		<View style={styles.container}>
			<Text style={styles.title}>KeyManager Debug</Text>
			<Button title="Generate Key Pair" onPress={runTest} />
			<Text style={styles.result}>{result}</Text>
			{error && <Text style={styles.error}>Error: {error}</Text>}
		</View>
	);
}

const styles = StyleSheet.create({
	container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
	title: { fontSize: 24, fontWeight: "bold", marginBottom: 20 },
	result: { marginTop: 20, textAlign: "center" },
	error: { color: "red", marginTop: 10 },
});
