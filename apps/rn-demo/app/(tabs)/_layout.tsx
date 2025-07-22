import { Tabs } from "expo-router";
import React from "react";
import { Text } from "react-native";

export default function TabLayout() {
	return (
		<Tabs
			screenOptions={{
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
		</Tabs>
	);
}
