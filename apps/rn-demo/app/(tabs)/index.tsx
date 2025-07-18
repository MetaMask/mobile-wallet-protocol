import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Button, FlatList, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { type PendingRequest, walletService } from "@/services/WalletService";

export default function HomeScreen() {
  const [status, setStatus] = useState(walletService.status);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const router = useRouter();

  useEffect(() => {
    const onStatusChange = (newStatus: string) => {
      setStatus(newStatus);
      if (newStatus !== "Connected") {
        setPendingRequests([]);
      }
    };

    const onRequest = (request: PendingRequest) => {
      setPendingRequests((prev) => [...prev, request]);
    };

    const tryResume = () => {
      setTimeout(() => {
        if (walletService.status === "Disconnected") {
          walletService.resumeLastSession();
        }
      }, 500);
    };

    walletService.on("statusChange", onStatusChange);
    walletService.on("request", onRequest);
    if (walletService.walletClient) {
      tryResume();
    } else {
      walletService.once("initialized", tryResume);
    }

    return () => {
      walletService.off("statusChange", onStatusChange);
      walletService.off("request", onRequest);
      walletService.off("initialized", tryResume);
    };
  }, []);

  const handleScanPress = () => router.push("/scanner" as any);
  const handleDisconnectPress = () => walletService.disconnect();

  const handleApprove = (request: PendingRequest) => {
    const response = {
      id: request.id,
      result: `Approved by RN Wallet at ${new Date().toLocaleTimeString()}`,
    };
    walletService.sendResponse(response);
    setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
  };

  const handleReject = (request: PendingRequest) => {
    const response = {
      id: request.id,
      error: { code: 4001, message: "User rejected the request." },
    };
    walletService.sendResponse(response);
    setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
  };

  const isConnected = status === "Connected";
  const isConnecting = status.includes("Connecting") || status.includes("Resuming");

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">Wallet Client</ThemedText>
        <ThemedView style={styles.statusContainer}>
          <ThemedText type="subtitle">Status:</ThemedText>
          <ThemedText style={styles.statusText}>{status}</ThemedText>
        </ThemedView>
        <ThemedView style={styles.buttonContainer}>
          {isConnected ? (
            <Button title="Disconnect" onPress={handleDisconnectPress} color="red" />
          ) : (
            <Button title="Scan QR Code" onPress={handleScanPress} disabled={isConnecting} />
          )}
        </ThemedView>
      </ThemedView>

      <View style={styles.requestsContainer}>
        <ThemedText type="subtitle">Incoming Requests</ThemedText>
        <FlatList
          data={pendingRequests}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.requestItem}>
              <ThemedText style={styles.requestMethod}>{item.method}</ThemedText>
              <ThemedText style={styles.requestParams}>{JSON.stringify(item.params, null, 2)}</ThemedText>
              <View style={styles.requestActions}>
                <Button title="Approve" onPress={() => handleApprove(item)} />
                <Button title="Reject" onPress={() => handleReject(item)} color="orange" />
              </View>
            </View>
          )}
          ListEmptyComponent={<ThemedText style={{ textAlign: "center", marginTop: 20 }}>No pending requests</ThemedText>}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 50,
    alignItems: "center",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
  },
  statusContainer: {
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  statusText: {
    marginTop: 8,
    fontFamily: "SpaceMono",
  },
  buttonContainer: {
    minHeight: 40,
  },
  requestsContainer: {
    flex: 1,
    padding: 20,
  },
  requestItem: {
    padding: 15,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  requestMethod: {
    fontWeight: "bold",
    fontSize: 16,
  },
  requestParams: {
    fontFamily: "SpaceMono",
    fontSize: 12,
    marginTop: 8,
    backgroundColor: "#f8f8f8",
    padding: 5,
  },
  requestActions: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 15,
  },
});
