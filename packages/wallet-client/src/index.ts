import { BaseClient, type ProtocolMessage } from "@metamask/mobile-wallet-protocol-core";

export class WalletClient extends BaseClient {
	protected handleMessage(_: ProtocolMessage): void {}
}
