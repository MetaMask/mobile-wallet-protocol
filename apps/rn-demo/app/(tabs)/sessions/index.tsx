// Path: app/(tabs)/sessions/index.tsx
import { Stack, useRouter } from "expo-router";
import { Alert, Button, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { useWallet } from "@/context/WalletContext";

export default function SessionsListScreen() {
	const { sessionManager, sessions } = useWallet();
	const router = useRouter();

	const handleClearAll = () => {
		Alert.alert("Clear All Sessions?", "This will delete all active sessions and cannot be undone.", [
			{ text: "Cancel", style: "cancel" },
			{
				text: "Clear All",
				style: "destructive",
				onPress: () => sessionManager?.deleteAllClients(),
			},
		]);
	};

	const handleDeleteOne = (sessionId: string) => {
		sessionManager?.deleteClient(sessionId);
	};

	return (
		<View style={styles.container}>
			<Stack.Screen
				options={{
					title: "All Sessions",
					headerRight: () => <Button title="Clear All" onPress={handleClearAll} color="red" />,
				}}
			/>
			{sessions.length === 0 ? (
				<Text>No active sessions.</Text>
			) : (
				<FlatList
					data={sessions}
					keyExtractor={(item) => item.id}
					style={styles.list}
					renderItem={({ item }) => (
						<Pressable onPress={() => router.push(`/sessions/${item.id}`)}>
							<View style={styles.sessionItem}>
								<View style={styles.sessionInfo}>
									<Text style={styles.sessionId}>ID: {item.id.substring(0, 16)}...</Text>
									<Text style={styles.sessionExpiry}>Expires: {new Date(item.expiresAt).toLocaleDateString()}</Text>
								</View>
								<Button title="Delete" color="red" onPress={() => handleDeleteOne(item.id)} />
							</View>
						</Pressable>
					)}
				/>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	list: {
		width: "100%",
	},
	sessionItem: {
		backgroundColor: "white",
		padding: 16,
		borderBottomWidth: 1,
		borderBottomColor: "#eee",
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		width: "100%",
	},
	sessionInfo: {
		flex: 1,
	},
	sessionId: {
		fontSize: 16,
		fontWeight: "bold",
	},
	sessionExpiry: {
		fontSize: 12,
		color: "gray",
		marginTop: 4,
	},
}); 