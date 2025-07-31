# Connection Flow

This document details the step-by-step process of establishing a secure, end-to-end encrypted session between a dApp and a mobile wallet.

## Connection Modes

The protocol supports two distinct connection flows, chosen by the dApp at the time of connection:

1.  **Untrusted Flow (Default):** The highest security mode, designed for connecting to a dApp in an untrusted browser or environment. It requires the user to verify the connection by entering a One-Time Password (OTP) displayed on their wallet.

2.  **Trusted Flow:** A streamlined, passwordless mode designed for trusted environments, such as when the dApp is running on the same mobile device as the wallet (via deep-linking) or on a user's trusted personal computer. This flow does **not** require an OTP.

---

### Untrusted Flow (OTP)

This is the default and highest security flow for connecting to dApps in untrusted environments.

#### Untrusted Flow Diagram

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
        DAppUI->>DappClient: connect({ mode: 'untrusted' })
        note over DappClient: - Changes state to CONNECTING<br/>- Creates 'SessionRequest' with mode='untrusted'
        DappClient->>DAppUI: emit('session_request', SessionRequest)
        note over DAppUI: SessionRequest now also contains the mode.
        DAppUI->>DAppUI: Generate QR code from SessionRequest JSON
        DAppUI-->>User: Displays QR Code
    end

    %% == 2. Wallet Scans & Handshake Offer ==
    rect rgb(255, 245, 235)
        User->>WalletUI: Scans QR code
        WalletUI->>WalletClient: connect({ sessionRequest })
        note over WalletClient: - Changes state to CONNECTING<br/>- Parses SessionRequest, sees mode='untrusted'
        WalletClient->>WalletClient: createSession(sessionRequest)
        WalletClient->>RelayServer: Subscribe to dApp's handshake channel
        RelayServer-->>WalletClient: OK
        WalletClient->>WalletClient: generateOtpWithDeadline()
        WalletClient->>WalletUI: emit('display_otp', otp, deadline)
        WalletUI-->>User: Displays OTP (e.g., "123456")
        
        WalletClient->>WalletClient: Encrypts HandshakeOfferPayload with OTP
        WalletClient->>RelayServer: Publish('handshake-offer') to handshake channel
        RelayServer->>DappClient: Forward('handshake-offer')
    end

    %% == 3. OTP Verification & Handshake Ack ==
    rect rgb(235, 255, 235)
        DappClient->>DappClient: Decrypts 'handshake-offer'
        DappClient->>DAppUI: emit('otp_required', { submit, cancel, deadline })
        DAppUI-->>User: Displays OTP input field

        User->>DAppUI: Enters OTP and clicks "Submit"
        DAppUI->>DappClient: otp_required.submit(otp)
        note over DappClient: - Verifies OTP matches the one from the offer.
        DappClient->>DappClient: Updates session and sends 'handshake-ack'
        DappClient->>RelayServer: Subscribe to new secure session channel
        RelayServer-->>DappClient: OK
        DappClient->>RelayServer: Publish('handshake-ack') to secure channel
        RelayServer->>WalletClient: Forward('handshake-ack')
    end

    %% == 4. Connection Finalized ==
    rect rgb(240, 240, 240)
        WalletClient->>WalletClient: Decrypts 'handshake-ack'
        note over WalletClient: The connection promise resolves.
        
        par
            WalletClient->>WalletClient: finalizeConnection()
            WalletClient->>WalletUI: emit('connected')
        and
            DappClient->>DappClient: finalizeConnection()
            DappClient->>DAppUI: emit('connected')
        end
        note over User: Both DApp and Wallet are now fully connected.
    end
```

#### Untrusted Flow Phase Breakdown

1.  **Phase 1: Session Initiation (DApp)**
    *   **Trigger:** The user clicks "Connect" in the dApp.
    *   **Action:** The `DappClient` is called with `connect({ mode: 'untrusted' })` or just `connect()` (untrusted is the default). It creates a `SessionRequest` containing its public key, a handshake channel ID, and `mode: 'untrusted'`.
    *   **Result:** The dApp UI renders the `SessionRequest` as a QR code.

2.  **Phase 2: Handshake Offer (Wallet)**
    *   **Trigger:** The user scans the QR code with their mobile wallet.
    *   **Action:** The `WalletClient` parses the `SessionRequest`, sees `mode: 'untrusted'`, and generates its own key pair, a new secure channel ID, and a 6-digit OTP.
    *   **Result:** The wallet UI displays the OTP. The `WalletClient` sends an encrypted `handshake-offer` to the dApp. This offer contains the wallet's public key, the new secure channel ID, and the OTP.

3.  **Phase 3: OTP Verification and Acknowledgement**
    *   **Trigger:** The `DappClient` receives the `handshake-offer`.
    *   **Action:** It decrypts the message and emits an `otp_required` event. The dApp UI prompts the user to enter the OTP they see on their mobile wallet.
    *   **Result:** If the user enters the correct OTP, the `DappClient` sends an encrypted `handshake-ack` message back to the wallet on the new secure channel.

4.  **Phase 4: Connection Finalized**
    *   **Trigger:** The `WalletClient` receives the `handshake-ack`.
    *   **Action:** Both clients save the completed session details to their `SessionStore`.
    *   **Result:** Both clients transition to a `CONNECTED` state. The temporary handshake channel is discarded, and all future communication is end-to-end encrypted over the secure channel.

---

### Trusted Flow (Passwordless)

This is the streamlined flow for trusted environments, providing the best user experience when security requirements allow.

#### Trusted Flow Diagram

```mermaid
sequenceDiagram
    actor User
    participant DAppUI as DApp UI
    participant DappClient
    participant RelayServer as Relay Server
    participant WalletClient
    participant WalletUI as Wallet UI

    %% == 1. Session Initiation & QR/Deeplink ==
    rect rgb(235, 245, 255)
        User->>DAppUI: Clicks "Connect" button
        DAppUI->>DappClient: connect({ mode: 'trusted' })
        note over DappClient: - Changes state to CONNECTING<br/>- Generates session ID & KeyPair
        DappClient->>DappClient: Creates 'SessionRequest' with mode='trusted'
        DappClient->>DAppUI: emit('session_request', SessionRequest)
        note over DAppUI: SessionRequest contains dApp's publicKey,<br/>handshake channel ID, mode, and expiry.
        DAppUI->>DAppUI: Generate QR code or Deeplink
        DAppUI-->>User: Displays QR Code or triggers Deeplink
    end

    %% == 2. Wallet Scans & Handshake ==
    rect rgb(255, 245, 235)
        User->>WalletUI: Scans QR code or follows Deeplink
        WalletUI->>WalletClient: connect({ sessionRequest })
        note over WalletClient: - Changes state to CONNECTING<br/>- Parses SessionRequest, sees mode='trusted'
        WalletClient->>WalletClient: createSession(sessionRequest)
        note over WalletClient: - Generates its own KeyPair<br/>- Creates a new, unique secure channel ID
        WalletClient->>RelayServer: Subscribe to dApp's handshake channel
        RelayServer-->>WalletClient: OK

        WalletClient->>WalletClient: Encrypts HandshakeOfferPayload
        note over WalletClient: Payload includes Wallet's publicKey and<br/>the new secure channel ID. **No OTP is generated.**
        WalletClient->>RelayServer: Publish('handshake-offer') to handshake channel
        RelayServer->>DappClient: Forward('handshake-offer')
    end

    %% == 3. Handshake Acknowledgement ==
    rect rgb(235, 255, 235)
        DappClient->>DappClient: Decrypts 'handshake-offer'
        note over DappClient: handleMessage() sees offer has no OTP.<br/>**OTP step is bypassed.**
        DappClient->>DappClient: Updates session and sends 'handshake-ack'
        DappClient->>RelayServer: Subscribe to new secure session channel
        RelayServer-->>DappClient: OK
        DappClient->>RelayServer: Publish('handshake-ack') to secure channel
        RelayServer->>WalletClient: Forward('handshake-ack')
    end

    %% == 4. Connection Finalized ==
    rect rgb(240, 240, 240)
        WalletClient->>WalletClient: Decrypts 'handshake-ack'
        note over WalletClient: The connection promise resolves.
        
        par
            WalletClient->>WalletClient: finalizeConnection()
            WalletClient->>WalletUI: emit('connected')
        and
            DappClient->>DappClient: finalizeConnection()
            DappClient->>DAppUI: emit('connected')
        end
        note over User: Both DApp and Wallet are now fully connected.
    end
```

#### Trusted Flow Phase Breakdown

1.  **Phase 1: Session Initiation (DApp)**
    *   **Trigger:** The user clicks "Connect" in the dApp.
    *   **Action:** The `DappClient` is called with `connect({ mode: 'trusted' })`. It generates a `SessionRequest` object containing its public key, a temporary handshake channel ID, and `mode: 'trusted'`.
    *   **Result:** The dApp UI renders the `SessionRequest` as a QR code or uses it to construct a deep link.

2.  **Phase 2: Handshake (Wallet)**
    *   **Trigger:** The user scans the QR code or follows the deep link.
    *   **Action:** The `WalletClient` parses the `SessionRequest` and detects `mode: 'trusted'`. It generates its own key pair and a new secure channel ID. **It does not generate or display an OTP.** It immediately sends an encrypted `handshake-offer` to the dApp containing its public key and the new secure channel ID.
    *   **Result:** The dApp receives the offer. The user is not prompted for any input.

3.  **Phase 3: Finalization**
    *   **Trigger:** The `DappClient` receives the `handshake-offer`.
    *   **Action:** Because the flow is `trusted`, the `DappClient` bypasses the OTP verification step. It immediately sends an encrypted `handshake-ack` message back to the wallet on the new secure channel.
    *   **Result:** The `WalletClient` receives the `handshake-ack`. Both clients save the completed session, discard the temporary handshake channel, and transition to the `CONNECTED` state.