# Phase 1 — Local Heartbeat and `editor.status`

Status: implementation in progress on `feat/phase1-local-heartbeat`.

## Goal

Prove one narrow, real request path before broader Unity automation:

```text
MCP client
  -> unity_get_status
  -> MCP/server core
  -> ws://127.0.0.1:5081
  -> Unity Editor package
  -> Unity main-thread dispatcher
  -> editor.status
  -> structured bridge result
  -> MCP result
```

## Scope

Implemented in this phase:

- local-only WebSocket bridge on `127.0.0.1:5081`,
- Unity outbound `ClientWebSocket` connection,
- v0 `hello` message with editor identity and connection generation,
- one active local editor connection,
- `editor.status` READ command,
- MCP `unity_get_status` tool,
- request IDs, route/generation checking, deadlines, timeout/disconnect failure,
- serialized Unity WebSocket sends,
- Unity main-thread dispatcher,
- basic reconnect after disconnect,
- Node integration tests with a simulated Unity peer.

Not in scope:

- GameObject mutation,
- Undo/dirty mutations,
- remote/cloud routing,
- pairing/authentication,
- multiple simultaneous editors,
- TLS,
- arbitrary C# execution,
- TeamForge integration.

## Transport decisions

### Unity client

Use `System.Net.WebSockets.ClientWebSocket` first. The bridge is outbound from Unity even for local mode; this matches the later hosted direction and avoids designing an inbound Unity listener that would be discarded.

Exactly one receive loop is used. Sends pass through one `SemaphoreSlim` so multiple command responses cannot issue overlapping `SendAsync` calls.

### Node server

Use `ws` with an exact dependency pin. Local mode binds only to `127.0.0.1`.

Initial protections:

- max payload: 1 MiB,
- per-message deflate disabled,
- unsupported/invalid messages do not become Unity actions,
- pending requests fail on disconnect,
- request deadlines and server-side timeouts are enforced.

## Connection identity

`editorId` identifies the local Unity project using a SHA-256 digest of the canonical project root path. It is a routing identity, not an authorization credential.

`connectionGeneration` changes when the Editor domain reloads/restarts. A command routed to an older generation is rejected by Unity as `routing/stale_connection`.

## Unity threading

Network callbacks must not access Unity Editor APIs directly.

The receive loop parses and validates on its async continuation, then uses `EditorMainThreadDispatcher.InvokeAsync` before calling `EditorStatusCommand.Execute`.

The first status payload contains:

- `unityVersion`,
- `projectName`,
- `activeScene`,
- `isPlaying`,
- `isCompiling`.

## Protocol messages

### Hello

Unity sends a v0 `hello` immediately after WebSocket connect. The source schema is `bridge-protocol/schemas/hello.v0.schema.json`.

### Command

The server sends the existing v0 command envelope with:

- `operation = editor.status`,
- `risk = read`,
- unique `requestId`,
- current editor route,
- deadline.

### Result

Unity returns the existing v0 result envelope. `ok: false` requires a structured error.

## Failure semantics

- no editor: MCP tool returns an error result,
- stale route/generation: Unity rejects before execution,
- expired deadline: Unity rejects before execution,
- unsupported operation: Unity rejects explicitly,
- malformed JSON/message: connection or request fails explicitly,
- editor disconnect: all pending requests fail,
- timeout: pending request is removed and fails.

Message delivery alone is not success; `unity_get_status` succeeds only after a matching Unity result is received and payload shape is validated.

## Verification gate

Before this phase is called verified:

1. Node dependency install/build/tests pass on the branch.
2. Local bridge integration tests pass with a simulated Unity WebSocket client.
3. `unity-package/` loads and compiles in Unity 6000.3.21f1.
4. Real Unity connects to `127.0.0.1:5081`.
5. A real MCP `unity_get_status` call returns current Unity state.
6. Restart/domain reload demonstrates reconnection with a new generation.

Until those runtime checks are recorded, implementation is not `Verified`.
