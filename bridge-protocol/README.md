# Unity AI Bridge Protocol v0

This directory contains the source-defined Unity-facing bridge contract.

The bridge protocol is intentionally separate from MCP. MCP-facing tools are adapted into these envelopes before commands reach Unity, allowing Unity command semantics to remain provider-neutral and transport-independent.

## Version

Initial protocol version: `0`

Version `0` is pre-stable. Breaking changes are allowed while early phases are under development, but contract changes must update schemas, TypeScript/C# protocol constants, fixtures, tests, and project status documentation together.

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
- `object.resolve` — re-resolve a Unity `GlobalObjectId` against current native Editor state,
- `gameObject.create` — create one empty root GameObject in the active scene with write-risk metadata, native readback, and mutation deduplication,
- `editor.diagnostics` — read bounded Console/compiler diagnostics with explicit coverage metadata.

`scene.hierarchy` accepts `maxDepth` and `maxNodes`. The implementation defaults to depth 8 / 200 nodes and rejects values beyond depth 32 / 500 nodes. Returned hierarchy paths are informational; `InstanceID` is transient and is not the sole durable identity. The result also carries Unity `GlobalObjectId` strings where available.

`object.resolve` accepts one `globalObjectId` string. Unity parses it with `GlobalObjectId.TryParse` and re-resolves it against current native Editor state. A syntactically valid identity may return `found=false` when the object no longer exists or its scene is unavailable. When found, the result returns the canonical GlobalObjectId plus current `InstanceID`, type, owner GameObject identity, scene, hierarchy path, sibling index, and active state. The transient fields are current observations, not replacement durable identities.

`gameObject.create` accepts:

- `name` — 1..128 characters and not whitespace-only,
- `mutationId` — 1..128 characters using letters, digits, `-`, `_`, `.`, or `:`.

The Node bridge generates a mutation id when the MCP caller omits one. Unity stores completed `gameObject.create` mutation results in Editor `SessionState`. The first create is now re-resolved through `GlobalObjectId` before its result is cached. A repeated delivery using the same `mutationId` and the same `name` re-resolves the cached target before replaying the result. If that object was undone, deleted, moved to a different scene, renamed, or otherwise no longer matches the completed mutation identity, the replay fails closed with `stale_target/mutation_replay_stale` and does not silently create a replacement. Reusing the same mutation id with different arguments is rejected. This remains narrow same-session retry protection, not a general durable transaction log.

`editor.diagnostics` accepts:

- `maxEntries` — 1..200, default 100,
- `minimumSeverity` — `error`, `warning`, or `log`; default `warning`.

Diagnostics results include current Console error/warning/log counts, recent captured Console messages, latest compiler warning/error messages, compilation state, truncation flags, and explicit coverage strings. Recent Console text is captured from the current domain load forward; the implementation does not depend on unsupported/internal `UnityEditor.LogEntries`. Compiler messages are observed through Unity's compilation pipeline and include source file/line/column metadata when Unity provides them.

Example request/result fixtures live in `fixtures/editor-status.*`, `fixtures/hierarchy.*`, `fixtures/object-resolve.*`, `fixtures/gameobject-create.*`, and `fixtures/diagnostics.*`.

## Result envelope

`schemas/result.v0.schema.json` defines structured completion/failure results, warnings, dirty/undo/compile metadata, changed-target hints, and categorized errors.

A successful network delivery is not sufficient for `ok: true`; callers should use `ok: true` only when the requested contract has been observed as completed.

For a first-time `gameObject.create`, Unity reports the scene as dirty and includes Undo metadata. A deduplicated replay reports `replayed: true` only after the cached target has been re-resolved and revalidated against current Unity state.

## Transport

The schema does not depend on WebSocket. The current local implementation uses WebSocket between the Node bridge and the Unity Editor package.
