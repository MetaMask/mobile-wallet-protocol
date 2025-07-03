/**
 * The handshake message sent by the wallet to the dApp.
 * Its payload is part of the protocol itself and should be strongly typed.
 */
export type WalletHandshake = {
	type: "wallet-handshake";
	payload: {
		publicKeyB64: string;
	};
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
export type ProtocolMessage = WalletHandshake | DappRequest | WalletResponse;
