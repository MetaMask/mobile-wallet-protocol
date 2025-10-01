# Mobile Wallet Protocol

Mobile Wallet Protocol provides a way to securely connect dApps to the Metamask mobile wallet, especially when they are running on different devices (e.g., a dApp on a desktop browser or on a react native app).

It acts as a secure bridge, enabling a dApp to send transaction requests and other messages to the mobile wallet and receive responses back, all with end-to-end encryption.

## Getting Started: Running Locally

Follow these steps to run the full end-to-end demo on your machine.

### Prerequisites

- **Node.js**: Use version 18.x or later.
- **Yarn**: This repository uses Yarn for package management.
- **Docker & Docker Compose**: Required to run the backend relay server.
- **Expo Go App**: To run the mobile wallet demo, you'll need the [Expo Go](https://expo.dev/go) app on your iOS or Android device.

### 1. Installation

Clone the repository and install all dependencies using Yarn.

```bash
git clone https://github.com/your-repo/mobile-wallet-protocol.git
cd mobile-wallet-protocol
yarn install
```

To use the demo apps locally you also have to build the packages.

```bash
yarn build
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
yarn release -i
```

Do **not** run `yarn create-release-branch` directly.

### Why a Custom Script is Necessary

The underlying release tool (`@metamask/create-release-branch`) automatically detects all workspaces defined in the root `package.json`. By default, this includes our non-publishable demo applications located in the `apps/` directory (like `web-demo` and `rn-demo`).

To work around this, the `yarn release` command executes a wrapper script (`scripts/create-release.mjs`) that does the following:

1.  **Backs Up and Modifies `package.json`**: The script first creates a backup of the original `package.json`. It then modifies the `package.json` file to remove non-publishable workspaces (e.g., the demo apps in `apps/*`).
2.  **Runs the Release Tool**: It executes the underlying release tool (`@metamask/create-release-branch`), which operates only on the publishable packages from the modified `package.json`.
3.  **Restores and Updates `package.json`**: After the release tool completes, the script reads the new version number. It then restores the original `package.json` contents from the backup and updates its version to match the new release version.
4.  **Finalizes the Release**: Finally, the script removes the backup file and runs `yarn install` and `yarn lint:fix` to ensure the project is in a consistent state.

This approach ensures that our development workflow, which relies on Yarn workspaces to link the demo apps with local packages, remains unbroken, while also producing a clean and correct release.
