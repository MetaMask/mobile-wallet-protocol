# Mobile Wallet Protocol

Mobile Wallet Protocol provides a way to securely connect dApps to the Metamask mobile wallet, especially when they are running on different devices (e.g., a dApp on a desktop browser or on a react native app).

It acts as a secure bridge, enabling a dApp to send transaction requests and other messages to the mobile wallet and receive responses back, all with end-to-end encryption.

## Getting Started: Running Locally

Follow these steps to run the full end-to-end demo on your machine.

### Prerequisites

*   **Node.js**: Use version 18.x or later.
*   **Yarn**: This repository uses Yarn for package management.
*   **Docker & Docker Compose**: Required to run the backend relay server.
*   **Expo Go App**: To run the mobile wallet demo, you'll need the [Expo Go](https://expo.dev/go) app on your iOS or Android device.

### 1. Installation

Clone the repository and install all dependencies using Yarn.

```bash
git clone https://github.com/your-repo/mobile-wallet-protocol.git
cd mobile-wallet-protocol
yarn install
```

### 2. Run the Backend Relay Server

The relay server runs in a Docker container. Use the provided Docker Compose file to start it.

```bash
docker compose -f backend/docker-compose.yml up -d
```

This command starts the `centrifugo` relay server in the background on `localhost:8000`. To stop the server, run:

```bash
docker compose -f backend/docker-compose.yml down
```

### 3. Run the Web Demo (DApp)

The web demo is a Next.js application that acts as the dApp.

```bash
cd apps/web-demo
yarn dev
```

Open your browser to `http://localhost:3000` to see the dApp interface.

### 4. Run the React Native Demo (Wallet)

The React Native demo is an Expo application that acts as the mobile wallet.

**Important:** Your mobile device must be on the same Wi-Fi network as your computer for this to work.

```bash
cd apps/rn-demo
yarn start
```

This will start the Metro bundler and display a QR code in your terminal. Open the **Expo Go app** on your phone and scan this QR code to launch the wallet demo. The app will automatically detect the local relay server running on your machine.

You can now use the demo wallet on your phone to scan the QR code displayed by the web dApp in your browser to test the full connection flow.

## Development

### Running Tests

To run all unit and integration tests, use the following command from the root directory:

```bash
yarn test
```

### Building Packages

To build all the core packages (`core`, `dapp-client`, `wallet-client`):

```bash
yarn build
```

### Linting and Formatting

The project uses Biome for linting and formatting. To check for issues:

```bash
yarn lint
```

To automatically fix formatting issues:

```bash
yarn lint:fix
```

## Release Process

Creating a new release for the packages in this monorepo requires a special script to ensure that only publishable packages are included in the release process.

### How to Create a Release

To initiate a release, run the following command from the root of the project:

```bash
yarn release
```

Do **not** run `yarn create-release-branch` directly.

### Why a Custom Script is Necessary

The underlying release tool (`@metamask/create-release-branch`) automatically detects all workspaces defined in the root `package.json`. By default, this includes our non-publishable demo applications located in the `apps/` directory (like `web-demo` and `rn-demo`).

To work around this, the `yarn release` command executes a wrapper script (`scripts/create-release.mjs`) that does the following:

1.  **Temporarily Modifies `package.json`**: It creates an in-memory version of `package.json` where the `apps/*` workspace is filtered out.
2.  **Runs the Release Tool**: It then executes the standard release tool, which now only sees the publishable packages under `packages/*`.
3.  **Restores `package.json`**: After the process completes (whether it succeeds or fails), it restores the original `package.json` file.

This approach ensures that our development workflow, which relies on Yarn workspaces to link the demo apps with local packages, remains unbroken, while also producing a clean and correct release.