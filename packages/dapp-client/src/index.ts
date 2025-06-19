import { getSessionId } from "@metamask/mobile-wallet-protocol-core";

export class DappClient {
	private sessionId: string;

	constructor() {
		this.sessionId = getSessionId();
		console.log(`DappClient initialized with session: ${this.sessionId}`);
	}

	public getSessionId(): string {
		return this.sessionId;
	}
}
