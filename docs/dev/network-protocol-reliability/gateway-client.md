# Gateway client single-owner semantics

- Node: TF-0439
- Baseline: origin/main @ 9cae5341
- Driven by: agent
- Evidence boundary: this document describes the Electron adapter and shared protocol boundary; TF-0444 remains the independent fault-injection gate.

## Ownership

The shared protocol package `openclaw_runtime/packages/gateway-protocol` is the single authority for protocol version values. Electron no longer declares a private protocol version; `electron/gateway/ws-client.ts` imports `MIN_CLIENT_PROTOCOL_VERSION` and `PROTOCOL_VERSION`.

Electron keeps a Main-process adapter for device identity, proxy and lifecycle concerns. It does not open a second protocol dialect: connect uses a `minProtocol`/`maxProtocol` range and rejects a hello whose negotiated protocol is outside that range.

Renderer never opens a Gateway WebSocket. The existing Main-owned WS -> HTTP -> IPC transport policy is unchanged.

## Sequence gap handling

The adapter tracks the last observed event `seq`. When a gap is detected it emits a typed callback `{ expected, received }`; the manager re-emits `gateway:sequence-gap` and `gateway:resubscribe`. Observability clears its local binding and re-establishes the required subscription instead of silently continuing on a stale stream.

## Reconnect and pending RPCs

- On socket close after handshake, all pending Gateway RPCs are rejected explicitly with `Gateway connection closed`.
- On reconnect, the adapter invokes `onReconnect` only when the manager marks the attempt as a reconnect.
- The manager emits `gateway:resubscribe`; observability clears the stale subscription and calls `ensureSubscriptions()`.
- The old socket is not used for unsubscribe during a reconnect because it is already gone.

## Tests

- `tests/unit/gateway-ws-client.test.ts`: protocol mismatch rejection, seq gap callback, reconnect callback, handshake paths.
- `tests/unit/gateway-events.test.ts`: event delivery semantics.
- `tests/unit/observability-trajectory-projection.test.ts`: reconnect/resubscribe path.
- `pnpm run typecheck`
- `pnpm run build:vite`

## Non-goals

- no Renderer transport switch
- no second protocol implementation
- no product default change
