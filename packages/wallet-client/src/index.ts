import { getSessionId } from "@metamask/mobile-wallet-protocol-core";

export class WalletClient {
	private sessionId: string;

	constructor() {
		this.sessionId = getSessionId();
		console.log(`WalletClient initialized with session: ${this.sessionId}`);
	}

	public getSessionId(): string {
		return this.sessionId;
	}
}
