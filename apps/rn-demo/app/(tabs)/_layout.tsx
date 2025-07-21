import { Tabs } from "expo-router";
import React from "react";
import { Text } from "react-native";

import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

export default function TabLayout() {
	const colorScheme = useColorScheme();

	return (
		<Tabs
			screenOptions={{
				tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
				headerShown: true,
			}}
		>
			<Tabs.Screen
				name="index"
				options={{
					title: "Wallet",
					tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 24 }}>📱</Text>,
				}}
			/>
			<Tabs.Screen
				name="debug"
				options={{
					title: "Debug",
					tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 24 }}>🐞</Text>,
				}}
			/>
		</Tabs>
	);
}
