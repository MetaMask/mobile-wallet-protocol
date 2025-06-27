- websocket -> channel history, fault tolerant connection/message-delivery/message-receive
- websocket -> define a websocket_transport_message type OR merge with the other message type

- test:unit, test:integration -> integration assumes docker compose is running
- grok -> websocket-transport implementation added + testing
- dapp client does not create qr code data or knows anything about qr code. its just creates a `session-request`
- think about storage holistically