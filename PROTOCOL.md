# Protocol design notes

This document is a design starting point, not a deployed wire protocol.

## Proposed frame

A production packet should include: protocol version, packet type, message UUID, sender identity fingerprint, recipient/group identifier, creation time, expiry, hop limit, sequence number, payload length, and authenticated payload.

All length fields must be bounded before allocation. Reject malformed frames, duplicate message IDs, expired packets, unsupported versions, and packets exceeding configured quotas.

## BLE constraints

BLE characteristic writes and notifications have small payload limits that vary with negotiated MTU and platform behavior. MeshChat must fragment larger application packets, serialize GATT operations per connection, reassemble with strict memory/time limits, and acknowledge at the application layer. A successful GATT write callback is not proof that a recipient displayed a message.

## Security requirements

- Authenticate peer keys; encryption alone does not establish identity.
- Use a unique nonce/IV for every AES-GCM encryption under a given key.
- Bind sender, recipient, message ID, and protocol version as authenticated data.
- Prevent replay with persistent sequence tracking and message-ID deduplication.
- Never relay plaintext.
- Require explicit user consent before participating as a relay.
