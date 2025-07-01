"use client";

import { DappClient } from "@metamask/mobile-wallet-protocol-dapp-client";
import { WalletClient } from "@metamask/mobile-wallet-protocol-wallet-client";
import { useEffect, useState } from "react";

export default function WalletDemo() {
	const [status, setStatus] = useState<string>("Not initialized");
	const [clientInfo, setClientInfo] = useState<string>("");

	useEffect(() => {
		// Just test that we can import and instantiate the clients
		try {
			setStatus("Imports successful! Clients are available.");
			setClientInfo(`DappClient: ${typeof DappClient}, WalletClient: ${typeof WalletClient}`);
		} catch (error) {
			setStatus("Error importing clients");
			setClientInfo(error instanceof Error ? error.message : "Unknown error");
		}
	}, []);

	return (
		<div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-900">
			<h2 className="text-xl font-bold mb-2">Mobile Wallet Protocol Demo</h2>
			<p className="text-sm mb-2">Status: {status}</p>
			<p className="text-xs text-gray-600 dark:text-gray-400">{clientInfo}</p>
		</div>
	);
}
