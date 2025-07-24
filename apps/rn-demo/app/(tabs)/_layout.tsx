// Path: app/(tabs)/_layout.tsx
import { Link, Tabs } from "expo-router";
import React from "react";
import { Button, Text } from "react-native";

export default function TabLayout() {
	return (
		<Tabs
			screenOptions={{
				headerShown: true,
			}}
		>
			<Tabs.Screen
				name="home" // Renamed from 'index'
				options={{
					title: "Home",
					tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 24 }}>🏠</Text>,
					headerRight: () => (
						<Link href="/scanner" asChild>
							<Button title="Scan" />
						</Link>
					),
				}}
			/>
			<Tabs.Screen
				name="sessions"
				options={{
					title: "Sessions",
					headerShown: false, // The stack navigator inside will provide the header
					tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 24 }}>📚</Text>,
				}}
			/>
		</Tabs>
	);
}
