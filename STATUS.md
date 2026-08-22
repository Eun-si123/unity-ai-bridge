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

Phase 0 was squash-merged to `main` on 2026-08-22. Its foundation checks are verified and the public repository license is **Apache License 2.0**. The heartbeat/status slice is fully runtime-verified on Windows / Unity 6000.3.21f1. The hierarchy-read slice is also now runtime-verified on Windows / Unity 6000.3.21f1 after fixing a Unity 6000.3 `GlobalObjectId.GetGlobalObjectIdsSlow` signature mismatch discovered by the real compile check. GameObject create and Console/compiler read remain planned.

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Core design/docs | Implemented | `AGENTS.md`, `DESIGN.md`, `DECISIONS.md`, `ROADMAP.md`, `CODEMAP.md`, `REFERENCES.md`. |
| Unity Editor package scaffold | Verified manually | Package Manager load and Unity AI Bridge Editor assembly compilation passed in Unity 6000.3.21f1 on Windows at revision `059727365c025eb1d18013371fe95e055517e570`; the hierarchy additions were subsequently compiled successfully after the Unity 6000.3 API compatibility fix. |
| Initial Unity target | Verified for current Phase 1 read slices | Unity 6000.3.21f1 compiled the package and completed real WebSocket/status, MCP status, reconnect lifecycle, and live hierarchy verification. Broader compatibility remains unverified. |
| Bridge protocol v0 | Implemented | Command/result schemas, TypeScript/C# protocol types/constants, and editor-status/hierarchy fixtures exist. |
| MCP/server scaffold | Verified | Phase 0 Node 24.19.0 install/build/tests passed in Actions run `32562797071`. |
| Phase 1 dependency lockfile | Verified | `mcp-server/package-lock.json` contains the pinned Phase 1 dependency graph and has been consumed by passing Phase 1 CI revisions. |
| Local WebSocket bridge server | Verified for status and hierarchy | Status path is verified in real Unity. `scene.hierarchy` routing/result validation passed simulated Node coverage and the real MCP-to-Unity hierarchy verifier. |
| Unity outbound WebSocket connection | Verified manually | Real `ClientWebSocket` connection, reconnect after domain reload, and renewed hello succeeded on Windows / Unity 6000.3.21f1. |
| Unity main-thread dispatcher | Verified for `editor.status` and hierarchy read | Real status and hierarchy requests completed through the dispatcher-backed Unity main-thread path. |
| `editor.status` bridge operation | Verified manually | Returned Unity `6000.3.21f1`, active scene `Assets/Scenes/SampleScene.unity`, `isPlaying=false`, and `isCompiling=false` before and after reconnect. |
| MCP `unity_get_status` | Verified manually | Official MCP TypeScript client completed stdio handshake, confirmed the tool was advertised, called `unity_get_status`, and received matching live Unity structured content. |
| `scene.hierarchy` bridge operation | Verified manually | Live `SampleScene` returned three root GameObjects in sibling order with bounded preorder metadata, non-empty `GlobalObjectId` values, and no truncation under default limits. |
| MCP `unity_get_hierarchy` | Verified manually | The real MCP stdio verifier returned the live active-scene hierarchy from Unity 6000.3.21f1 with `rootCount=3`, `returnedNodeCount=3`, `maxDepth=8`, `maxNodes=200`, and both truncation flags false. |
| Hierarchy object identity | Verified for the tested saved scene | Each returned node had a Unity `GlobalObjectId` string plus transient `instanceId`; roots had empty parent IDs and sibling indices 0/1/2. Broader identity behavior for unsaved/new scene objects remains unverified. |
| Reconnect / stale-generation lifecycle | Verified manually + CI support | Real domain reload preserved `editorId`, changed `connectionGeneration` from `1787395056602` to `1787395125304`, rejected an explicitly stale generation with `routing/stale_connection`, and succeeded on a new-generation `editor.status`. |
| Node local-bridge integration tests | Verified | Coverage includes status round-trip, hierarchy request/result validation, hierarchy input limits, explicit routed stale-generation propagation, and no-editor failure. Node Verification run `32568901972` and Phase 1 Local Bridge Verification run `32568901982` passed at revision `2619472abe97ffe9149e05fbe826936f439d62e2`; later hierarchy commits changed only Unity C# compatibility and documentation. |
| GameObject mutation tools | Planned | Not implemented. |
| Console/compiler tools beyond status | Planned | Not implemented. |
| Undo integration | Planned | Not implemented. |
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

Heartbeat/status slice:

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

Hierarchy slice:

- [x] `scene.hierarchy` Unity command source implemented
- [x] bounded preorder traversal implemented (`maxDepth`, `maxNodes`)
- [x] batched `GlobalObjectId` capture implemented using the Unity 6000.3-compatible preallocated output-array signature
- [x] transient `instanceId` is not used as sole durable identity
- [x] MCP `unity_get_hierarchy` source implemented
- [x] simulated bridge hierarchy round-trip test implemented
- [x] invalid hierarchy limit tests implemented
- [x] real `verify:hierarchy` MCP verifier implemented
- [x] hierarchy Node/bridge CI recorded as passing on the latest Node/TypeScript revision (`2619472abe97ffe9149e05fbe826936f439d62e2`)
- [x] Unity package compile with hierarchy source verified in 6000.3.21f1 after the API compatibility fix
- [x] real MCP `unity_get_hierarchy` result observed and matched the live `SampleScene` root hierarchy

Remaining Phase 1 minimum after hierarchy:

- [ ] create a simple GameObject with write retry/dedup protection
- [ ] read Console/compiler errors

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
Revision under test: Phase 1 heartbeat branch containing verify:mcp-unity; exact local checkout SHA not separately captured
Environment: Windows, Unity 6000.3.21f1, Node 24.x, official MCP TypeScript client 2.0.0
Action: npm.cmd --prefix mcp-server run verify:mcp-unity
Expected: MCP initialize handshake succeeds; unity_get_status is advertised; tool call reaches live Unity and returns current structured Editor state
Observed: MCP handshake PASS; unity_get_status advertised; MCP unity_get_status PASS returned unityVersion=6000.3.21f1, projectName=My project (1), activeScene=Assets/Scenes/SampleScene.unity, isPlaying=false, isCompiling=false
Result: PASS (manual user verification)
```

### 2026-08-22 — Real domain reload / reconnect / stale-generation lifecycle

```text
Revision under test: Phase 1 heartbeat branch containing verify:reconnect; exact local checkout SHA not separately captured
Environment: Windows, Unity 6000.3.21f1, Node 24.x
Action: npm.cmd --prefix mcp-server run verify:reconnect -> trigger Unity script/domain reload
Expected: same editorId reconnects with a new connectionGeneration; a command explicitly routed to the old generation is rejected with routing/stale_connection; editor.status succeeds on the new generation
Observed: editorId remained 2c64561eff545bef6b876adfd7c4945172c640117d136cef1a0b6cace98f653d; connectionGeneration changed 1787395056602 -> 1787395125304; stale generation rejection PASS with routing/stale_connection; post-reconnect editor.status PASS returned SampleScene, isPlaying=false, isCompiling=false
Result: PASS (manual user verification)
```

### 2026-08-22 — Hierarchy slice first CI attempt

```text
Revision under test: 7ccc84b8f3f3176ed04b6662293a5a7ce1741780
Environment: GitHub Actions ubuntu-24.04, Node 24.19.0
Action: dependency refresh -> npm ci -> TypeScript build -> tests
Observed: build failed before tests because exactOptionalPropertyTypes rejected explicitly passing undefined hierarchy option fields from the MCP handler
Result: FAIL (fixed in subsequent revision)
Notes: this was a TypeScript option-shape error, not a Unity runtime result.
```

### 2026-08-22 — Hierarchy Node/bridge verification

```text
Revision under test: 2619472abe97ffe9149e05fbe826936f439d62e2
Environment: GitHub Actions ubuntu-24.04, Node 24.19.0
Action: dependency refresh -> npm ci -> TypeScript build -> Node tests
Observed: Node Verification run 32568901972 and Phase 1 Local Bridge Verification run 32568901982 completed successfully
Result: PASS
Notes: later hierarchy commits changed the Unity C# batch GlobalObjectId call for 6000.3 compatibility and documentation, not the Node/TypeScript hierarchy path.
```

### 2026-08-22 — Real Unity 6000.3 hierarchy compile + MCP read

```text
Revision under test: hierarchy branch containing Unity 6000.3 compatibility fix `005327886b6ed40f35c8338559e721d256d900b6` plus subsequent documentation-only commit(s)
Environment: Windows, Unity 6000.3.21f1, SampleScene, Node 24.x, official MCP TypeScript client 2.0.0
Action: git pull -> Unity compile -> npm.cmd --prefix mcp-server run verify:hierarchy
Expected: hierarchy source compiles; MCP `unity_get_hierarchy` reaches live Unity and returns the active scene's bounded hierarchy
Observed: initial pre-fix compile failed with CS1615 because Unity 6000.3 does not accept `out` for the second `GetGlobalObjectIdsSlow` parameter. After changing to a preallocated `GlobalObjectId[]`, Unity compiled and the MCP verifier returned sceneName=SampleScene, scenePath=Assets/Scenes/SampleScene.unity, rootCount=3, returnedNodeCount=3, maxDepth=8, maxNodes=200, truncatedByDepth=false, truncatedByNodes=false. Nodes were Main Camera, Directional Light, and Global Volume in sibling order 0/1/2, each with a non-empty GlobalObjectId.
Result: PASS (manual user verification)
```

## Known unknowns

- exact `GlobalObjectId` behavior for unsaved/new scene objects and unusual object cases,
- long-term Unity support matrix beyond 6000.3.21f1,
- future multi-editor routing design,
- remote authentication/pairing cryptography,
- public hosting provider,
- ChatGPT integration/submission requirements at implementation time,
- BYO MCP security model and whether it will ship.
