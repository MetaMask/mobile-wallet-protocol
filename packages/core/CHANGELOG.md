# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Add `validatePeerKey` method to `IKeyManager` interface for peer public key validation at handshake and resume time ([#70](https://github.com/MetaMask/mobile-wallet-protocol/pull/70))

### Fixed

- Guard against `NaN` in session expiry timestamps ([#70](https://github.com/MetaMask/mobile-wallet-protocol/pull/70))

## [0.3.1]

### Fixed

- Fixed rapid reconnect issue for shared clients ([#55](https://github.com/MetaMask/mobile-wallet-protocol/pull/55))

## [0.3.0]

### Added

- Added feature to share the underlying ws connection in the WebsocketTransport ([#49](https://github.com/MetaMask/mobile-wallet-protocol/pull/49))

## [0.2.0]

### Added

- Added initial message to the session request ([#47](https://github.com/MetaMask/mobile-wallet-protocol/pull/47))
- Exposing base client state ([#43](https://github.com/MetaMask/mobile-wallet-protocol/pull/43))

### Changed

- Added splitting when packages are built with tsup ([#46](https://github.com/MetaMask/mobile-wallet-protocol/pull/46))

## [0.1.1]

### Added

- New optional method to proactively reconnect the underlying transport ([#39](https://github.com/MetaMask/mobile-wallet-protocol/pull/39))

### Changed

- Added `files` attribute to package json file ([#40](https://github.com/MetaMask/mobile-wallet-protocol/pull/40))

## [0.1.0]

### Changed

- Move `eciesjs` to dev dependencies ([#36](https://github.com/MetaMask/mobile-wallet-protocol/pull/36))

### Removed

- **BREAKING:** Remove `KeyManager` ([#36](https://github.com/MetaMask/mobile-wallet-protocol/pull/36))

## [0.0.6]

### Added

- Initial release of the package ([#35](https://github.com/MetaMask/mobile-wallet-protocol/pull/35))

[Unreleased]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-core@0.3.1...HEAD
[0.3.1]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-core@0.3.0...@metamask/mobile-wallet-protocol-core@0.3.1
[0.3.0]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-core@0.2.0...@metamask/mobile-wallet-protocol-core@0.3.0
[0.2.0]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-core@0.1.1...@metamask/mobile-wallet-protocol-core@0.2.0
[0.1.1]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-core@0.1.0...@metamask/mobile-wallet-protocol-core@0.1.1
[0.1.0]: https://github.com/MetaMask/mobile-wallet-protocol/compare/@metamask/mobile-wallet-protocol-core@0.0.6...@metamask/mobile-wallet-protocol-core@0.1.0
[0.0.6]: https://github.com/MetaMask/mobile-wallet-protocol/releases/tag/@metamask/mobile-wallet-protocol-core@0.0.6
