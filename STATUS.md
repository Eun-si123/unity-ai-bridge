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

Phase 0 was squash-merged to `main` on 2026-08-22. Its foundation checks are verified and the public repository license is **Apache License 2.0**. The heartbeat/status slice is fully runtime-verified on Windows / Unity 6000.3.21f1. The next hierarchy-read slice is now **Implemented** on `feat/phase1-hierarchy` with simulated Node coverage and a real MCP verifier, but it is not yet runtime-verified in a real Unity Editor. GameObject create and Console/compiler read remain planned.

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Core design/docs | Implemented | `AGENTS.md`, `DESIGN.md`, `DECISIONS.md`, `ROADMAP.md`, `CODEMAP.md`, `REFERENCES.md`. |
| Unity Editor package scaffold | Verified manually | Package Manager load and Unity AI Bridge Editor assembly compilation passed in Unity 6000.3.21f1 on Windows at revision `059727365c025eb1d18013371fe95e055517e570`. |
| Initial Unity target | Verified for heartbeat/status slice | Unity 6000.3.21f1 compiled the package and completed real WebSocket/status, MCP status, and reconnect lifecycle verification. Hierarchy additions still require a fresh Unity compile/runtime check. |
| Bridge protocol v0 | Implemented | Command/result schemas, TypeScript/C# protocol types/constants, and editor-status/hierarchy fixtures exist. |
| MCP/server scaffold | Verified | Phase 0 Node 24.19.0 install/build/tests passed in Actions run `32562797071`. |
| Phase 1 dependency lockfile | Verified | `mcp-server/package-lock.json` contains the pinned Phase 1 dependency graph and has been consumed by passing Phase 1 CI revisions. |
| Local WebSocket bridge server | Verified for status; hierarchy implemented | Status path is verified in real Unity. `scene.hierarchy` request routing and result validation are implemented with simulated Node coverage; real hierarchy runtime verification pending. |
| Unity outbound WebSocket connection | Verified manually | Real `ClientWebSocket` connection, reconnect after domain reload, and renewed hello succeeded on Windows / Unity 6000.3.21f1. |
| Unity main-thread dispatcher | Verified for `editor.status`; hierarchy uses same boundary | Real status requests completed through the dispatcher. Hierarchy source also dispatches Unity API access through this boundary, but the hierarchy path is not yet manually verified. |
| `editor.status` bridge operation | Verified manually | Returned Unity `6000.3.21f1`, active scene `Assets/Scenes/SampleScene.unity`, `isPlaying=false`, and `isCompiling=false` before and after reconnect. |
| MCP `unity_get_status` | Verified manually | Official MCP TypeScript client completed stdio handshake, confirmed the tool was advertised, called `unity_get_status`, and received matching live Unity structured content. |
| `scene.hierarchy` bridge operation | Implemented | Reads the active scene on the Unity main thread, traverses in preorder, applies depth/node bounds, batches `GlobalObjectId` lookup, and returns truncation metadata. Real Unity result pending. |
| MCP `unity_get_hierarchy` | Implemented | Tool exposes bounded `maxDepth`/`maxNodes` input and returns structured hierarchy content. `verify:hierarchy` exists for the real MCP-to-Unity check. Real Unity result pending. |
| Hierarchy object identity | Implemented contract, runtime behavior pending | Each node returns Unity `GlobalObjectId` string plus transient `instanceId`, parent GlobalObjectId, depth/sibling/child metadata, and an informational hierarchy path. The project does not treat `InstanceID` or hierarchy path alone as durable identity. |
| Reconnect / stale-generation lifecycle | Verified manually + CI support | Real domain reload preserved `editorId`, changed `connectionGeneration` from `1787395056602` to `1787395125304`, rejected an explicitly stale generation with `routing/stale_connection`, and succeeded on a new-generation `editor.status`. |
| Node local-bridge integration tests | Verified on prior/current slice revisions as recorded | Coverage includes status round-trip, hierarchy request/result validation, hierarchy input limits, explicit routed stale-generation propagation, and no-editor failure. Current-head CI is recorded only after the latest documentation/code commit completes. |
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
- [x] batched `GlobalObjectId` capture implemented
- [x] transient `instanceId` is not used as sole durable identity
- [x] MCP `unity_get_hierarchy` source implemented
- [x] simulated bridge hierarchy round-trip test implemented
- [x] invalid hierarchy limit tests implemented
- [x] real `verify:hierarchy` MCP verifier implemented
- [ ] latest hierarchy branch Node/bridge CI recorded as passing
- [ ] Unity package compile with hierarchy source verified in 6000.3.21f1
- [ ] real MCP `unity_get_hierarchy` result observed and matched the live scene

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

## Known unknowns

- real Unity 6000.3.21f1 compile/runtime behavior for the new hierarchy source,
- exact `GlobalObjectId` values Unity returns for all scene-object cases, including unsaved/new scene objects,
- long-term Unity support matrix beyond 6000.3.21f1,
- future multi-editor routing design,
- remote authentication/pairing cryptography,
- public hosting provider,
- ChatGPT integration/submission requirements at implementation time,
- BYO MCP security model and whether it will ship.
