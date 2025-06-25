Of course. This is an excellent way to approach the problem. By defining the interfaces, responsibilities, and boundaries first, we can create a clean and maintainable architecture.

Here is a proposed design for the four components, focusing on the simplified, PIN-less, and storage-less WebSocket flow. I've structured it in tables as requested.

### Summary of the Simplified Handshake Flow

This design is based on the following simplified sequence:

1.  **DappClient**: The dApp calls `connect()`. The client generates a `sessionID` and its key pair. It then emits an event with the QR code data (`sessionID` + `dappPublicKey`) for the UI to render. It then connects to the relay server and waits on a public channel derived from the `sessionID`.
2.  **WalletClient**: The wallet scans the QR code. The app calls `pair(qrCodeData)`. The client parses the data, generates its own key pair, and connects to the same public channel.
3.  **WalletClient**: It immediately publishes its public key to the dApp on the public channel.
4.  **DappClient & WalletClient**: Upon receiving each other's public keys, both clients can independently perform an Elliptic Curve Diffie-Hellman (ECDH) key exchange to derive a `sharedSecret`.
5.  **Channel Switch**: Both clients use the `sharedSecret` to derive a new, private channel ID (e.g., by hashing the secret). They both unsubscribe from the public channel and subscribe to this new private one.
6.  **Confirmation**: To confirm the switch, one client (e.g., the dApp) sends a final `handshake-complete` message over the new private channel. Once the other client receives it, the connection is fully established. All future communication is encrypted with the `sharedSecret` and occurs on this private channel.

---

### Component Design Tables

#### 1. WebSocket Transport (`packages/core/src/transport/websocket.ts`)

This component is a low-level implementation detail. Its public interface, `ITransport`, should remain simple and focused solely on the mechanics of communication. It is considered stable for this design.

| Category | Description |
| :--- | :--- |
| **Component/File** | `packages/core/src/transport/websocket.ts` implementing the `ITransport` interface from `packages/core/src/domain/transport.ts`. |
| **Responsibilities** | • Manage the raw WebSocket connection to the relay server (e.g., Centrifugo).<br/>• Handle connection lifecycle events (`connecting`, `connected`, `disconnected`).<br/>• Abstract away the specifics of the publish/subscribe mechanism.<br/>• Forward raw messages and events up to the client. |
| **Boundaries** | • **Knows:** The relay server URL and the Centrifugo protocol.<br/>• **Does NOT Know:** Anything about encryption, sessions, key pairs, or whether it's a dApp or a wallet. It just passes string data back and forth on named channels. |
| **Core Methods** | `connect(): Promise<void>`<br/>`disconnect(): Promise<void>`<br/>`subscribe(channel: string): Promise<void>`<br/>`publish(channel: string, message: string): Promise<void>` |
| **Events Emitted** | `on('connected', handler)`<br/>`on('disconnected', handler)`<br/>`on('error', handler)`<br/>`on('message', handler)` |

---

#### 2. Base Client (`packages/core/src/base-client.ts`)

This is the abstract foundation. It provides the common machinery but delegates the specific connection logic (the handshake) to its subclasses. **Crucially, we are removing the `storage` dependency for this design pass.**

| Category | Description |
| :--- | :--- |
| **Component/File** | `packages/core/src/base-client.ts` (Abstract Class) |
| **Responsibilities** | • Own and manage the `ITransport` and `IKeyManager` instances.<br/>• Manage and protect the client's own key pair and the derived `sharedSecret`.<br/>• Provide high-level methods for sending and receiving **encrypted** messages once a session is established.<br/>• Define the contract for the `handshake` process that subclasses must implement.<br/>• Forward lifecycle events (`connected`, `disconnected`, `error`) to the consumer. |
| **Boundaries** | • **Knows:** How to use the transport to send/receive data and how to use the key manager to encrypt/decrypt. It knows about its own keys and the shared secret.<br/>• **Does NOT Know:** The specific steps of the handshake (e.g., generating a QR code vs. parsing one). It doesn't know its role as "dApp" or "wallet". |
| **Methods & Properties** | **`protected transport: ITransport`**: The communication layer.<br/>**`protected keyManager: IKeyManager`**: The crypto utility.<br/>**`protected keyPair: KeyPair | null`**: The client's own ephemeral key pair.<br/>**`protected sharedSecret: Uint8Array | null`**: The secret derived from ECDH for symmetric encryption.<br/><br/>`abstract handshake(...args: any[]): Promise<void>`: **(New)** This is the core change. Each subclass must implement this method to define its role in the connection flow.<br/><br/>`async disconnect(): Promise<void>`: Tears down the transport connection and clears session state (keys, secrets).<br/><br/>`protected async sendMessage(payload: unknown): Promise<void>`: Encrypts a payload with the `sharedSecret` and publishes it to the current private channel. Throws if the handshake is not complete.<br/><br/>`protected async deriveSharedSecret(theirPublicKey: Uint8Array): Promise<void>`: A utility to perform ECDH and store the resulting `sharedSecret`. |
| **Events Emitted** | `on('connected', handler)`: Emitted when the entire handshake process is complete.<br/>`on('disconnected', handler)`<br/>`on('error', handler)`<br/>`on('message', handler)`: Emitted with a decrypted message payload. |

---

#### 3. dApp Client (`packages/dapp-client/src/index.ts`)

This is the concrete implementation for the dApp (e.g., a web browser). Its primary job is to initiate a session and display a QR code.

| Category | Description |
| :--- | :--- |
| **Component/File** | `packages/dapp-client/src/index.ts` (Extends `BaseClient`) |
| **Responsibilities** | • Implement the dApp-side of the handshake.<br/>• Generate a unique `sessionID` for the connection.<br/>• Generate its own ephemeral key pair.<br/>• Construct the QR code payload.<br/>• Communicate to the consuming application when to display the QR code. |
| **Boundaries** | • **Knows:** It is the initiator of the connection.<br/>• **Does NOT Know:** How to render a QR code. It only provides the data string via an event/callback. It doesn't manage any UI state. |
| **Core Methods** | `async connect(): Promise<void>`: The primary entry point for the dApp developer. It triggers the entire handshake process.<br/><br/>`async handshake(): Promise<void>`: **(Implementation of abstract method)**<br/> 1. Generate `sessionID` and own `keyPair`.<br/> 2. Construct QR payload string (`{ sessionId, publicKey }`).<br/> 3. Emit `display-qr-code` event with the payload.<br/> 4. Connect and subscribe to the public channel: `public:${sessionId}`.<br/> 5. Wait for the wallet's public key message.<br/> 6. On receipt, derive `sharedSecret`, switch to the private channel, send confirmation, and emit `connected`.<br/><br/>`async sendRequest(payload: unknown): Promise<void>`: Uses the `sendMessage` method from `BaseClient` to send an application-level request to the wallet. |
| **Events/Callbacks** | `on('display-qr-code', (qrCodeData: string) => { ... })`: **(Crucial for UI)** Tells the dApp UI what data to render in a QR code.<br/>`on('connected', () => { ... })`: Signals that the handshake is complete and the session is secure and ready.<br/>`on('message', (payload: unknown) => { ... })`: Forwards messages received from the wallet. |

---

#### 4. Wallet Client (`packages/wallet-client/src/index.ts`)

This is the concrete implementation for the wallet (e.g., a mobile app). Its primary job is to respond to a connection request initiated by a dApp.

| Category | Description |
| :--- | :--- |
| **Component/File** | `packages/wallet-client/src/index.ts` (Extends `BaseClient`) |
| **Responsibilities** | • Implement the wallet-side of the handshake.<br/>• Parse an incoming QR code payload.<br/>• Generate its own ephemeral key pair.<br/>• Respond to the dApp to establish the secure channel. |
| **Boundaries** | • **Knows:** It is the responder in the connection flow.<br/>• **Does NOT Know:** How the QR code was obtained (e.g., via a camera). It just receives the data string. |
| **Core Methods** | `async pair({ qrCodeData: string }): Promise<void>`: The primary entry point for the wallet developer, called after a QR code is scanned. It triggers the handshake.<br/><br/>`async handshake(dappPublicKey: Uint8Array, sessionId: string): Promise<void>`: **(Implementation of abstract method)**<br/> 1. Generate own `keyPair`.<br/> 2. Connect and subscribe to the public channel: `public:${sessionId}`.<br/> 3. Publish own public key to the channel.<br/> 4. Immediately derive `sharedSecret`, switch to the private channel, and wait for the dApp's confirmation message.<br/> 5. On receipt, emit `connected`.<br/><br/>`async sendResponse(payload: unknown): Promise<void>`: Uses `sendMessage` from `BaseClient` to send an application-level response to the dApp. |
| **Events/Callbacks** | `on('connected', () => { ... })`: Signals that the handshake is complete and the session is secure and ready.<br/>`on('message', (payload: unknown) => { ... })`: Forwards requests received from the dApp that require user action (e.g., sign transaction). |