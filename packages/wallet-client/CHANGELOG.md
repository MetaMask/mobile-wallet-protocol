# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0]

### Uncategorized

- fix: add runtime validation for ConnectionMode (WAPI-1129) ([#75](https://github.com/MetaMask/mobile-wallet-protocol/pull/75))
- fix: replace Math.random() with crypto.getRandomValues() (WAPI-1127) ([#73](https://github.com/MetaMask/mobile-wallet-protocol/pull/73))
- fix: SessionStore race conditions and async initialization (WAPI-1118)
- fix: drop Node 18 support, require Node 20+ (WAPI-1133) ([#76](https://github.com/MetaMask/mobile-wallet-protocol/pull/76))

### Fixed

- Replace `Math.random()` with `crypto.getRandomValues()` for OTP generation
- Validate peer public keys during session creation ([#70](https://github.com/MetaMask/mobile-wallet-protocol/pull/70))
- Fix client stuck in CONNECTING state when session creation fails ([#70](https://github.com/MetaMask/mobile-wallet-protocol/pull/70))

## [0.2.2]

### Added

- Export ESM paths ([#57](https://github.com/MetaMask/mobile-wallet-protocol/pull/57))

## [0.2.1]

### Changed

- Wallet client is now doing optimistic connections on the trusted flow ([#50](https://github.com/MetaMask/mobile-wallet-protocol/pull/50))

## [0.2.0]

### Added

- Added initial message to the session request ([#47](https://github.com/MetaMask/mobile-wallet-protocol/pull/47))

### Changed

- Added splitting when packages are built with tsup ([#46](https://github.com/MetaMask/mobile-wallet-protocol/pull/46))

## [0.1.1]

### Changed

- Added `files` attribute to package json file ([#40](https://github.com/MetaMask/mobile-wallet-protocol/pull/40))

## [0.1.0]

### Added

- **BREAKING:** Add required `keymanager` option to `WalletClient` constructor options ([#36](https://github.com/MetaMask/mobile-wallet-protocol/pull/36))

## [0.0.6]

### Added

- Initial release of the package ([#35](https://github.com/MetaMask/mobile-wallet-protocol/pull/35))

[Unreleased]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-wallet-client@0.3.0...HEAD
[0.3.0]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-wallet-client@0.2.2...@metamask/mobile-wallet-protocol-wallet-client@0.3.0
[0.2.2]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-wallet-client@0.2.1...@metamask/mobile-wallet-protocol-wallet-client@0.2.2
[0.2.1]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-wallet-client@0.2.0...@metamask/mobile-wallet-protocol-wallet-client@0.2.1
[0.2.0]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-wallet-client@0.1.1...@metamask/mobile-wallet-protocol-wallet-client@0.2.0
[0.1.1]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-wallet-client@0.1.0...@metamask/mobile-wallet-protocol-wallet-client@0.1.1
[0.1.0]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-wallet-client@0.0.6...@metamask/mobile-wallet-protocol-wallet-client@0.1.0
[0.0.6]: https://github.com/MetaMask/mobile-wallet-protocol/releases/tag/@metamask/mobile-wallet-protocol-wallet-client@0.0.6
