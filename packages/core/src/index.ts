export { BaseClient } from "./base-client";
export type { KeyPair } from "./domain/key-pair";
export type { IKVStore } from "./domain/kv-store";
export type { DappRequest, ProtocolMessage, WalletHandshake, WalletResponse } from "./domain/protocol-message";
export type { SessionRequest } from "./domain/session-request";
export { KeyManager } from "./key-manager";
export { WebSocketTransport, type WebSocketTransportOptions } from "./transport/websocket/index";
