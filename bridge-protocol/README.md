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

`requestId` identifies one transport request/response exchange. Mutation operations may additionally carry an operation-specific idempotency identity so an ambiguous transport retry does not blindly re-execute a Unity write.

Current implemented operations include:

- `editor.status` — read current Unity/editor state,
- `scene.hierarchy` — read a bounded preorder snapshot of the active scene hierarchy,
- `editor.diagnostics` — read bounded Console counts/recent captured entries and latest compiler diagnostics,
- `gameObject.create` — create one empty root GameObject in the active scene with write-risk metadata and mutation deduplication.

`scene.hierarchy` currently accepts `maxDepth` and `maxNodes` arguments. The implementation defaults to depth 8 / 200 nodes and rejects values beyond depth 32 / 500 nodes. Returned hierarchy paths are informational; `InstanceID` is transient and is not the sole durable identity. The result also carries `GlobalObjectId` strings for scene objects where Unity can provide them.

`editor.diagnostics` accepts:

- `maxEntries` — 1..200, default 100,
- `minimumSeverity` — `error`, `warning`, or `log`, default `warning`.

The diagnostics result deliberately separates three coverage levels:

1. current Console counts from public `ConsoleWindowUtility.GetConsoleLogCounts`,
2. recent Console message text captured through `Application.logMessageReceivedThreaded` since the current script-domain load,
3. the latest compiler messages observed through `CompilationPipeline`, persisted in Editor `SessionState` so the latest completed compilation snapshot can survive a successful domain reload.

Unity does not expose a supported public iterator for all historical Console entry text. The early implementation therefore reports its coverage explicitly instead of depending on internal `UnityEditor.LogEntries` APIs.

`gameObject.create` accepts:

- `name` — 1..128 characters and not whitespace-only,
- `mutationId` — 1..128 characters using letters, digits, `-`, `_`, `.`, or `:`.

The Node bridge generates a mutation id when the MCP caller omits one. Unity stores completed `gameObject.create` mutation results in Editor `SessionState`; a repeated delivery using the same `mutationId` and the same `name` replays the prior result rather than creating another object. Reusing the same mutation id with different arguments is rejected. This is Phase 1 retry protection, not a general-purpose durable transaction log across full Editor restarts.

Example request/result fixtures live in `fixtures/editor-status.*`, `fixtures/hierarchy.*`, `fixtures/diagnostics.*`, and `fixtures/gameobject-create.*`.

## Result envelope

`schemas/result.v0.schema.json` defines structured completion/failure results, warnings, dirty/undo/compile metadata, changed-target hints, and categorized errors.

A successful network delivery is not sufficient for `ok: true`; callers should use `ok: true` only when the requested contract has been observed as completed.

For a first-time `gameObject.create`, Unity reports the scene as dirty and includes Undo metadata. A deduplicated replay reports `replayed: true` in the operation result and does not perform a second mutation.

## Transport

The schema does not depend on WebSocket. The current local implementation uses WebSocket between the Node bridge and the Unity Editor package.
