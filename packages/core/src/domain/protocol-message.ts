/**
 * The unencrypted payload sent by the wallet during the handshake.
 * This is encrypted and placed inside the WalletHandshake message.
 */
export type WalletHandshakePayload = {
	publicKeyB64: string;
	channelId: string;
	pin: string;
	expiresAt: number;
};

/**
 * The handshake message sent by the wallet to the dApp on the public channel.
 * Its payload is an encrypted WalletHandshakePayload.
 */
export type WalletHandshake = {
	type: "wallet-handshake";
	payload: {
		encrypted: string;
	};
};

/**
 * The confirmation message sent by the dApp to the wallet on the new private channel.
 */
export type HandshakeComplete = {
	type: "handshake-complete";
};

/**
 * A generic request sent from the dApp to the wallet.
 * The payload is application-defined.
 */
export type DappRequest = {
	type: "dapp-request";
	payload: unknown;
};

/**
 * A generic response sent from the wallet to the dApp.
 * The payload is application-defined.
 */
export type WalletResponse = {
	type: "wallet-response";
	payload: unknown;
};

/**
 * A union of all possible protocol messages.
 */
export type ProtocolMessage = WalletHandshake | HandshakeComplete | DappRequest | WalletResponse;
