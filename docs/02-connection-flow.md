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

### Trusted Flow (Passwordless And Optimistic)

This is the streamlined flow for trusted environments, providing the best user experience when security requirements allow. It uses an optimistic, non-blocking connection model designed to work reliably on same-device platforms where the dApp may be suspended by the OS.

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
        note over DappClient: - Changes state to CONNECTING<br/>- Generates SessionRequest with a ~1 min timeout
        DappClient->>DAppUI: emit('session_request', SessionRequest)
        DAppUI->>DAppUI: Generate QR code or Deeplink
        DAppUI-->>User: Displays QR Code or triggers Deeplink
        note over DappClient: DApp is now waiting for the handshake offer. If the user<br/>deep-links, the dApp's process may be frozen by the OS.
    end

    %% == 2. Wallet Scans & Optimistic Connection ==
    rect rgb(255, 245, 235)
        User->>WalletUI: Scans QR code or follows Deeplink
        WalletUI->>WalletClient: connect({ sessionRequest })
        note over WalletClient: - Changes state to CONNECTING<br/>- Parses SessionRequest, sees mode='trusted'
        WalletClient->>WalletClient: createSession() & saves to storage
        WalletClient->>RelayServer: Subscribe to new secure session channel
        RelayServer-->>WalletClient: OK

        WalletClient->>WalletClient: Encrypts HandshakeOfferPayload
        WalletClient->>RelayServer: Publish('handshake-offer') to handshake channel
        note over WalletClient: The connection promise resolves NOW.<br/>The wallet considers itself CONNECTED.
        WalletClient->>WalletUI: emit('connected')
    end

    %% == 3. DApp Finalizes Connection on Resume ==
    rect rgb(235, 255, 235)
        User->>DAppUI: Switches back to the dApp
        note over DAppUI: The dApp's process unfreezes.
        DappClient->>RelayServer: Subscribes to handshake channel
        RelayServer->>DappClient: Immediately delivers historical 'handshake-offer'
        DappClient->>DappClient: Decrypts 'handshake-offer', finalizes session
        DappClient->>RelayServer: Subscribe to new secure session channel
        RelayServer-->>DappClient: OK
        note over DappClient: The connection promise resolves.<br/>The dApp considers itself CONNECTED.<br/>**No handshake-ack is sent.**
        DappClient->>DAppUI: emit('connected')
    end

    note over User: Both DApp and Wallet are now fully connected.
```

#### Trusted Flow Phase Breakdown

1.  **Phase 1: Session Initiation (DApp)**
    *   **Trigger:** The user clicks "Connect" in the dApp.
    *   **Action:** The `DappClient` is called with `connect({ mode: 'trusted' })`. It generates a `SessionRequest` with a specific time-to-live (e.g., 1 minutes) for the wallet to scan. The dApp then begins waiting for the wallet's response. If the user deep-links to the wallet, the dApp's process is typically frozen by the mobile OS at this stage.

2.  **Phase 2: Optimistic Connection (Wallet)**
    *   **Trigger:** The user scans the QR code or follows the deep link.
    *   **Action:** The `WalletClient` parses the `SessionRequest`. It immediately creates the final secure session, saves it to its storage, and subscribes to the new secure communication channel. It sends an encrypted `handshake-offer` to the dApp's temporary handshake channel.
    *   **Result:** The `WalletClient.connect()` promise resolves immediately after sending the offer. The wallet considers the connection established and is ready to receive messages. It does **not** wait for an acknowledgement.

3.  **Phase 3: Finalization (DApp)**
    *   **Trigger:** The user switches back to the dApp, causing the OS to resume its process.
    *   **Action:** The `DappClient`'s transport connects to the relay server and subscribes to the handshake channel. The relay server immediately delivers the `handshake-offer` message from its history. The dApp processes the offer, finalizes the session details (wallet's public key, secure channel ID), and subscribes to the secure channel.
    *   **Result:** The `DappClient.connect()` promise resolves. The dApp now considers itself connected. No `handshake-ack` is sent back to the wallet. Both clients are now fully connected and can communicate securely.