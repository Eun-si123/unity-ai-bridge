# Project Status

Canonical source of truth for what is actually implemented and verified in **Unity AI Bridge**.

Do not infer implementation from README examples, design diagrams, decisions, roadmaps, issues, plans, or other Unity MCP projects.

## Status vocabulary

- **Planned** — desired, no implementation should be assumed.
- **In progress** — partial/incomplete implementation exists.
- **Implemented** — implementation exists but relevant runtime behavior may still be unverified.
- **Verified** — reproduced with evidence on a named revision/environment.
- **Blocked** — progress is prevented by a named unresolved dependency/problem.

## Current phase

**Phase 1 — Minimal local end-to-end**  
Overall status: **In progress**

Phase 0 was squash-merged to `main` on 2026-08-22. Its foundation checks are verified and the public repository license is **Apache License 2.0**. The heartbeat/status and hierarchy-read slices are runtime-verified on Windows / Unity 6000.3.21f1. The first bounded write slice, empty root GameObject creation with explicit mutation identity and duplicate-retry protection, is also runtime-verified on Windows / Unity 6000.3.21f1. Console/compiler diagnostics remain the final planned Phase 1 minimum capability.

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Core design/docs | Implemented | `AGENTS.md`, `DESIGN.md`, `DECISIONS.md`, `ROADMAP.md`, `CODEMAP.md`, `REFERENCES.md`. |
| Unity Editor package scaffold | Verified manually | Package Manager load and Unity AI Bridge Editor assembly compilation passed in Unity 6000.3.21f1 on Windows; later hierarchy and GameObject-create additions also compiled in the same target during their real verification runs. |
| Initial Unity target | Verified for current Phase 1 slices | Unity 6000.3.21f1 completed real WebSocket/status, MCP status, reconnect lifecycle, hierarchy read, and bounded GameObject create/dedup verification. Broader compatibility remains unverified. |
| Bridge protocol v0 | Implemented | Command/result schemas, TypeScript/C# protocol types/constants, and current operation fixtures/docs exist. |
| MCP/server scaffold | Verified | Phase 0 Node 24.19.0 install/build/tests passed in Actions run `32562797071`. |
| Phase 1 dependency lockfile | Verified | `mcp-server/package-lock.json` contains the pinned Phase 1 dependency graph and has been consumed by passing Phase 1 CI revisions. |
| Local WebSocket bridge server | Verified for current Phase 1 slices | Status, hierarchy, and `gameObject.create` requests have completed through the real local bridge against Unity 6000.3.21f1. |
| Unity outbound WebSocket connection | Verified manually | Real `ClientWebSocket` connection, reconnect after domain reload, and renewed hello succeeded on Windows / Unity 6000.3.21f1. |
| Unity main-thread dispatcher | Verified for status, hierarchy, and create | Real read operations and the first write operation completed through the dispatcher-backed Unity main-thread path. |
| `editor.status` bridge operation | Verified manually | Returned Unity `6000.3.21f1`, active scene `Assets/Scenes/SampleScene.unity`, `isPlaying=false`, and `isCompiling=false` before and after reconnect. |
| MCP `unity_get_status` | Verified manually | Official MCP TypeScript client completed stdio handshake, confirmed the tool was advertised, called `unity_get_status`, and received matching live Unity structured content. |
| `scene.hierarchy` bridge operation | Verified manually | Live `SampleScene` returned root GameObjects in sibling order with bounded preorder metadata, non-empty `GlobalObjectId` values, and expected truncation metadata. |
| MCP `unity_get_hierarchy` | Verified manually | The real MCP stdio verifier returned the live active-scene hierarchy from Unity 6000.3.21f1. |
| Hierarchy object identity | Verified for the tested saved scene | Returned nodes use Unity `GlobalObjectId` plus transient `instanceId`; broader identity behavior for unsaved/new scene objects remains unverified. |
| Reconnect / stale-generation lifecycle | Verified manually + CI support | Real domain reload preserved `editorId`, changed `connectionGeneration`, rejected an explicitly stale generation with `routing/stale_connection`, and succeeded on the new generation. |
| Node local-bridge integration tests | Verified | Coverage includes status, hierarchy, stale-generation routing, no-editor failure, GameObject create write routing, explicit mutation-id reuse, and pre-delivery create validation. Latest create-slice CI passed in Node Verification run `32606458264` and Phase 1 Local Bridge Verification run `32606458269` at revision `2969bcfa379f10498d4b5bac69fb085f209d499d`. |
| GameObject create write slice | Verified manually + CI support | `unity_create_game_object` / `gameObject.create` created one empty root object, marked the scene dirty, registered Undo, returned a `GlobalObjectId`, and replayed the same result rather than duplicating the object when the same `mutationId` was delivered again. |
| Mutation retry/dedup protection | Verified for `gameObject.create` immediate same-session retry | First call reported `replayed=false`; the second call with the same mutation ID and arguments reported `replayed=true`, returned the same `GlobalObjectId`, and hierarchy readback found exactly one matching object. General mutation dedup and post-Undo/deletion replay semantics remain future reliability work. |
| Undo integration | Verified for the bounded GameObject-create slice only | Created objects are registered with Unity Undo. General mutation Undo/rollback behavior remains planned for Phase 2. |
| Console/compiler tools beyond status | Planned | Not implemented. |
| Remote gateway / Easy Connect | Planned | Not implemented. |
| Pairing/authentication | Planned | Not implemented. |
| Multi-user/editor routing | Planned | Local bridge intentionally supports one active editor only. |
| ChatGPT integration | Planned | Not implemented or submitted. |

## Phase 0 exit criteria

Phase 0 is complete.

- [x] repository roles/boundaries documented
- [x] AI/contributor grounding rules documented
- [x] detailed design baseline documented
- [x] architecture decisions recorded
- [x] public roadmap documented
- [x] external-reference/code-reuse rules documented
- [x] initial source tree exists
- [x] initial Unity support target selected and pinned
- [x] Phase 0 dependency graph pinned with generated lockfile
- [x] bridge protocol v0 schema exists in source
- [x] executable initial test/check commands exist
- [x] Phase 0 dependency install/build/test recorded as passing
- [x] Unity package load/compile check recorded as passing
- [x] project license selected: Apache-2.0

## Phase 1 implementation target

```text
MCP client
   -> MCP/server core
   -> local WebSocket bridge
   -> Unity outbound connection
   -> Unity main-thread dispatcher
   -> bounded Unity Editor API operation
   -> structured result
   -> MCP result
```

### Heartbeat/status slice

- [x] local bridge design documented
- [x] v0 hello contract implemented
- [x] local WebSocket server source implemented
- [x] Unity outbound connection/reconnect source implemented
- [x] Unity main-thread dispatcher source implemented
- [x] `editor.status` source implemented
- [x] MCP `unity_get_status` source implemented
- [x] simulated Unity Node integration tests implemented
- [x] Unity package compiles in 6000.3.21f1
- [x] real Unity hello/status observed
- [x] real MCP stdio `unity_get_status` observed
- [x] domain reload reconnection verified with new connection generation
- [x] stale connection generation rejected in a real Editor lifecycle
- [x] post-reconnect status succeeds on the new generation

### Hierarchy slice

- [x] `scene.hierarchy` Unity command source implemented
- [x] bounded preorder traversal implemented (`maxDepth`, `maxNodes`)
- [x] batched `GlobalObjectId` capture implemented using the Unity 6000.3-compatible preallocated output-array signature
- [x] transient `instanceId` is not used as sole durable identity
- [x] MCP `unity_get_hierarchy` source implemented
- [x] simulated bridge hierarchy round-trip test implemented
- [x] invalid hierarchy limit tests implemented
- [x] real `verify:hierarchy` MCP verifier implemented
- [x] hierarchy Node/bridge CI recorded as passing
- [x] Unity package compile with hierarchy source verified in 6000.3.21f1
- [x] real MCP `unity_get_hierarchy` result observed and matched the live `SampleScene` hierarchy

### First write slice — GameObject create

- [x] `gameObject.create` Unity command implemented for one empty root GameObject
- [x] MCP `unity_create_game_object` implemented with `risk=write`
- [x] name and mutation-id validation implemented before Unity mutation
- [x] Unity Undo registration and scene dirty marking implemented
- [x] `GlobalObjectId` + transient `instanceId` returned
- [x] completed mutation result cached in Unity `SessionState`
- [x] same `mutationId` + same arguments replays the cached result instead of creating again
- [x] same `mutationId` + different arguments is rejected
- [x] verifier waits for a live Unity connection before the first write
- [x] ambiguous connection/timeout retry uses the same mutation ID
- [x] Node/TypeScript create tests pass
- [x] real Unity create succeeds
- [x] real same-mutation retry reports `replayed=true`
- [x] real hierarchy readback finds exactly one matching object

### Remaining Phase 1 minimum

- [ ] read Console/compiler errors/diagnostics through a bounded structured MCP tool

## Verification log

### 2026-08-22 — Node/MCP Phase 0 scaffold

```text
Revision under test: 246ac56c5f62ba44e4546cc7185e5de751e72fa8
Environment: GitHub Actions ubuntu-24.04, Node 24.19.0, npm 11.17.0
Action: generate lockfile -> npm ci -> npm run build -> npm test
Observed: all verification steps completed successfully in Actions run 32562797071
Result: PASS
```

### 2026-08-22 — Phase 1 local bridge simulation

```text
Revision under test: 5417d25d50d7617bc1df0e9ee82c367cd97f3344
Environment: GitHub Actions ubuntu-24.04, Node 24.19.0
Action: refresh/generate lockfile -> npm ci -> TypeScript build -> all Node tests
Expected: protocol tests pass; simulated Unity WebSocket peer can hello, receive editor.status, return a matching result; no-editor request fails explicitly
Observed: Node Verification run 32564186863 and Phase 1 Local Bridge Verification run 32564186926 completed successfully
Result: PASS
Notes: earlier CI exposed and fixed a real ws callback contract bug where successful sends may report `null` rather than `undefined`.
```

### 2026-08-22 — Unity package load/compile

```text
Revision under test: 059727365c025eb1d18013371fe95e055517e570
Environment: Windows, Unity 6000.3.21f1
Action: Package Manager -> Add package from disk -> unity-package/package.json -> compile/domain reload
Expected: package loads and Unity AI Bridge Editor assembly compiles with zero compile errors
Observed: user reported no errors
Result: PASS (manual user verification)
```

### 2026-08-22 — Real Unity local bridge/status round trip

```text
Revision under test: 059727365c025eb1d18013371fe95e055517e570
Environment: Windows, Unity 6000.3.21f1, Node 24.x Phase 1 verifier
Action: npm.cmd --prefix mcp-server run verify:unity
Expected: local bridge listens on 127.0.0.1:5081; real Unity sends protocol v0 hello; bridge sends editor.status; Unity returns current Editor state
Observed: hello received with unityVersion=6000.3.21f1 and a valid editorId/connectionGeneration; editor.status PASS returned activeScene=Assets/Scenes/SampleScene.unity, isPlaying=false, isCompiling=false
Result: PASS
```

### 2026-08-22 — Real MCP stdio -> live Unity status

```text
Environment: Windows, Unity 6000.3.21f1, Node 24.x, official MCP TypeScript client 2.0.0
Action: npm.cmd --prefix mcp-server run verify:mcp-unity
Observed: MCP handshake PASS; unity_get_status advertised; live Unity structured Editor state returned
Result: PASS (manual user verification)
```

### 2026-08-22 — Real domain reload / reconnect / stale-generation lifecycle

```text
Environment: Windows, Unity 6000.3.21f1, Node 24.x
Action: npm.cmd --prefix mcp-server run verify:reconnect -> trigger Unity script/domain reload
Observed: editorId remained stable; connectionGeneration changed; stale generation was rejected with routing/stale_connection; post-reconnect editor.status succeeded
Result: PASS (manual user verification)
```

### 2026-08-22 — Hierarchy Node/bridge verification

```text
Revision under test: 2619472abe97ffe9149e05fbe826936f439d62e2
Environment: GitHub Actions ubuntu-24.04, Node 24.19.0
Action: dependency refresh -> npm ci -> TypeScript build -> Node tests
Observed: Node Verification run 32568901972 and Phase 1 Local Bridge Verification run 32568901982 completed successfully
Result: PASS
```

### 2026-08-22 — Real Unity 6000.3 hierarchy compile + MCP read

```text
Environment: Windows, Unity 6000.3.21f1, SampleScene, Node 24.x, official MCP TypeScript client 2.0.0
Action: Unity compile -> npm.cmd --prefix mcp-server run verify:hierarchy
Observed: after fixing the Unity 6000.3 `GetGlobalObjectIdsSlow` signature mismatch, Unity compiled and MCP returned the live SampleScene hierarchy with non-empty GlobalObjectId values
Result: PASS (manual user verification)
```

### 2026-08-23 — First GameObject create + duplicate-retry protection

```text
Revision under test: 2969bcfa379f10498d4b5bac69fb085f209d499d
Environment: Windows, Unity 6000.3.21f1, SampleScene, Node 24.x, official MCP TypeScript client 2.0.0
CI: Node Verification run 32606458264 PASS; Phase 1 Local Bridge Verification run 32606458269 PASS
Action: npm.cmd --prefix mcp-server run verify:create
Expected: verifier waits for Unity; first create mutates once; identical retry uses the same mutationId and does not duplicate; hierarchy readback finds one object
Observed first result: replayed=false, name=MCP_Create_Verify_1787442917163, GlobalObjectId=GlobalObjectId_V1-2-99c9720ab356a0642a771bea13969a05-1399885475-0, siblingIndex=3
Observed retry: replayed=true with the same mutationId and the same GlobalObjectId
Observed hierarchyMatches: 1
Observed Editor state: one MCP_Create_Verify object visible in the SampleScene hierarchy; scene marked dirty
Result: PASS (manual user verification)
Notes: the first verifier attempt exposed a readiness race (`No Unity Editor is connected`) because the MCP verifier called create before the Editor connected. The verifier was corrected to poll `unity_get_status` first and to reuse the same mutationId for retryable ambiguous failures. The corrected verifier then passed.
```

## Known unknowns / remaining reliability work

- exact `GlobalObjectId` behavior for unsaved/new scene objects and unusual object cases,
- GameObject-create dedup replay after the created object is manually deleted or undone is not yet semantically revalidated; Phase 2 native readback/verification should close this gap,
- mutation dedup persistence across a full Unity Editor restart is not provided by the current `SessionState` implementation,
- general write serialization/idempotency across future mutation families remains unimplemented,
- long-term Unity support matrix beyond 6000.3.21f1,
- future multi-editor routing design,
- remote authentication/pairing cryptography,
- public hosting provider,
- ChatGPT integration/submission requirements at implementation time,
- BYO MCP security model and whether it will ship.
