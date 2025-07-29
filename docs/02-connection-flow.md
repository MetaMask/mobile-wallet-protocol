# Connection Flow

This document details the step-by-step process of establishing a secure, end-to-end encrypted session between a dApp and a mobile wallet.

## Connection Flow Diagram

The following sequence diagram illustrates the entire "happy path" of a connection, from the initial user action to the first message exchange.

```mermaid
sequenceDiagram
    actor User
    participant DAppUI as DApp UI
    participant DappClient
    participant RelayServer as Relay Server
    participant WalletClient
    participant WalletUI as Wallet UI

    %% == 1. Session Initiation & QR Code Generation ==
    rect rgb(235, 245, 255)
        User->>DAppUI: Clicks "Connect" button
        DAppUI->>DappClient: connect()
        note over DappClient: - Changes state to CONNECTING<br/>- Calls createPendingSessionAndRequest()
        DappClient->>DappClient: Generates session ID & KeyPair
        note over DappClient: Creates a temporary 'pendingSession' and a 'SessionRequest'<br/>with a TTL (e.g., 60s).
        DappClient->>DAppUI: emit('session_request', SessionRequest)
        note over DAppUI: SessionRequest contains dApp's publicKey,<br/>a unique handshake channel ID, and expiry.
        DAppUI->>DAppUI: Generate QR code from SessionRequest JSON
        DAppUI-->>User: Displays QR Code
    end

    %% == 2. Wallet Scans & Handshake Offer ==
    rect rgb(255, 245, 235)
        User->>WalletUI: Scans QR code
        WalletUI->>WalletClient: connect({ sessionRequest })
        note over WalletClient: - Changes state to CONNECTING<br/>- Validates SessionRequest is not expired
        WalletClient->>WalletClient: createSession(sessionRequest)
        note over WalletClient: - Generates its own KeyPair<br/>- Creates a new, unique secure channel ID (e.g., `session:uuid()`)
        WalletClient->>RelayServer: Subscribe to dApp's handshake channel
        RelayServer-->>WalletClient: OK
        WalletClient->>WalletClient: generateOtpWithDeadline()
        note over WalletClient: Generates a 6-digit OTP with a TTL (e.g., 60s).
        WalletClient->>WalletUI: emit('display_otp', otp, deadline)
        WalletUI-->>User: Displays OTP (e.g., "123456")
        
        WalletClient->>WalletClient: Encrypts HandshakeOfferPayload
        note over WalletClient: Payload includes Wallet's publicKey,<br/>new secure channel ID, and OTP.
        WalletClient->>RelayServer: Publish('handshake-offer') to handshake channel
        RelayServer->>DappClient: Forward('handshake-offer')
    end

    %% == 3. OTP Verification & Handshake Ack ==
    rect rgb(235, 255, 235)
        DappClient->>DappClient: Decrypts 'handshake-offer'
        note over DappClient: handleMessage() processes the offer.
        DappClient->>DAppUI: emit('otp_required', { submit, cancel, deadline })
        DAppUI-->>User: Displays OTP input field

        User->>DAppUI: Enters OTP and clicks "Submit"
        DAppUI->>DappClient: otp_required.submit(otp)
        note over DappClient: - Verifies OTP matches the one from the offer.<br/>- If correct, promise resolves.
        DappClient->>DappClient: updateSessionAndAcknowledge()
        note over DappClient: - Updates its session with Wallet's publicKey<br/>and the new secure channel ID.<br/>- Encrypts 'handshake-ack' message.
        DappClient->>RelayServer: Subscribe to new secure session channel
        RelayServer-->>DappClient: OK
        DappClient->>RelayServer: Publish('handshake-ack') to secure channel
        RelayServer->>WalletClient: Forward('handshake-ack')
    end

    %% == 4. Connection Finalized & First Message Exchange ==
    rect rgb(240, 240, 240)
        WalletClient->>WalletClient: Decrypts 'handshake-ack'
        note over WalletClient: The waitForHandshakeAck() promise resolves.
        
        par
            WalletClient->>WalletClient: finalizeConnection()
            note over WalletClient: - Saves session to SessionStore<br/>- Clears handshake channel transport<br/>- Changes state to CONNECTED
            WalletClient->>WalletUI: emit('connected')
        and
            DappClient->>DappClient: finalizeConnection()
            note over DappClient: - Saves session to SessionStore<br/>- Clears handshake channel transport<br/>- Changes state to CONNECTED
            DappClient->>DAppUI: emit('connected')
        end
        note over User: Both DApp and Wallet are now fully connected.

        User->>DAppUI: Clicks "Send Transaction"
        DAppUI->>DappClient: sendRequest({ method: 'eth_sendTransaction', ... })
        DappClient->>DappClient: Encrypts request with Wallet's public key
        DappClient->>RelayServer: Publish(encryptedRequest) to secure channel
        RelayServer->>WalletClient: Forward(encryptedRequest)
        WalletClient->>WalletClient: Decrypts request with its private key
        WalletClient->>WalletUI: emit('message', { method: 'eth_sendTransaction', ... })
        WalletUI-->>User: Displays transaction for approval

        User->>WalletUI: Clicks "Approve"
        WalletUI->>WalletClient: sendResponse({ result: '0x...' })
        WalletClient->>WalletClient: Encrypts response with dApp's public key
        WalletClient->>RelayServer: Publish(encryptedResponse) to secure channel
        RelayServer->>DappClient: Forward(encryptedResponse)
        DappClient->>DappClient: Decrypts response with its private key
        DappClient->>DAppUI: emit('message', { result: '0x...' })
        DAppUI-->>User: Displays transaction confirmation
    end
```

## Phase Breakdown

The connection process can be broken down into four distinct phases:

### Phase 1: Session Initiation (DApp)
1.  **Trigger:** The user clicks "Connect" in the dApp.
2.  **Action:** The `DappClient` generates a new session ID and a cryptographic key pair. It creates a `SessionRequest` object containing its public key and a temporary, public **handshake channel** ID.
3.  **Result:** The dApp UI receives the `SessionRequest` and renders it as a QR code. This request has a short Time-to-Live (TTL), typically 60 seconds.

### Phase 2: Handshake Offer (Wallet)
1.  **Trigger:** The user scans the QR code with their mobile wallet.
2.  **Action:** The `WalletClient` parses the `SessionRequest`, validates it hasn't expired, and generates its own key pair. It also creates a new, unique, and **secure channel** ID for future communication. The wallet then generates a 6-digit OTP.
3.  **Result:** The wallet UI displays the OTP to the user. The `WalletClient` sends an encrypted `handshake-offer` message to the dApp via the public handshake channel. This offer contains the wallet's public key, the new secure channel ID, and the OTP.

### Phase 3: OTP Verification and Acknowledgement
1.  **Trigger:** The `DappClient` receives the `handshake-offer` message.
2.  **Action:** It decrypts the message and emits an `otp_required` event. The dApp UI prompts the user to enter the OTP they see on their mobile wallet.
3.  **Result:** The user enters the OTP. If it matches the one in the offer, the `DappClient` considers the handshake successful. It sends an encrypted `handshake-ack` message back to the wallet, but this time on the **new secure channel** specified in the offer.

### Phase 4: Connection Finalized
1.  **Trigger:** The `WalletClient` receives the `handshake-ack` message on the secure channel.
2.  **Action:** Both clients now have each other's public keys and have agreed on a secure channel. They save the completed session details to their respective persistent `SessionStore`. This allows the session to be resumed later if the app is closed.
3.  **Result:** Both clients transition to a `CONNECTED` state and emit a `connected` event. The temporary handshake channel is discarded. All future communication is end-to-end encrypted and occurs over the secure channel.
