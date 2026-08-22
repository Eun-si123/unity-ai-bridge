# Unity AI Bridge Protocol v0

This directory contains the source-defined Unity-facing bridge contract.

The bridge protocol is intentionally separate from MCP. MCP-facing tools are adapted into these envelopes before commands reach Unity, allowing Unity command semantics to remain provider-neutral and transport-independent.

## Version

Initial protocol version: `0`

Version `0` is pre-stable. Breaking changes are allowed while Phase 0/1 is under development, but changes must update schemas, TypeScript/C# protocol constants, fixtures, tests, and project status documentation together when the contract itself changes.

## Command envelope

`schemas/command.v0.schema.json` defines:

- `protocolVersion`
- `requestId`
- `operation`
- `arguments`
- `risk`
- optional routing identity
- optional deadline metadata

Current implemented operations include:

- `editor.status` — read current Unity/editor state,
- `scene.hierarchy` — read a bounded preorder snapshot of the active scene hierarchy,
- `scene.create_game_object` — create one root GameObject in the active scene as an undoable write mutation.

`scene.hierarchy` accepts `maxDepth` and `maxNodes` arguments. The implementation defaults to depth 8 / 200 nodes and rejects values beyond depth 32 / 500 nodes. Returned hierarchy paths are informational; `InstanceID` is transient and is not the sole durable identity. The result also carries `GlobalObjectId` strings for scene objects where Unity can provide them.

`scene.create_game_object` requires `name` and `idempotencyKey`, and must be sent with `risk: "write"`. The idempotency key represents mutation intent: retrying the same intended create must reuse the same key, while a new create intent must use a new key. The current Unity implementation stores the consumed key and target `GlobalObjectId` in `SessionState`, which survives domain reloads within the same Editor session. A same-key retry returns the original target instead of creating a duplicate. Reusing a key with different arguments is rejected, and if the original target has been removed the consumed mutation is not blindly replayed.

GameObject creation registers Unity Undo, marks the scene dirty without saving it, and verifies the created target by converting its `GlobalObjectId` back to an Object reference before reporting success.

Example request/result fixtures live in `fixtures/editor-status.*`, `fixtures/hierarchy.*`, and `fixtures/create-game-object.*`.

## Result envelope

`schemas/result.v0.schema.json` defines structured completion/failure results, warnings, dirty/undo/compile metadata, changed-target hints, and categorized errors.

A successful network delivery is not sufficient for `ok: true`; callers should use `ok: true` only when the requested contract has been observed as completed.

## Transport

The schema does not depend on WebSocket. The current local implementation uses WebSocket between the Node bridge and the Unity Editor package.
