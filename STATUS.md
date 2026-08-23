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

**Phase 2 — Reliability Core**  
Overall status: **In progress**

**Phase 1 — Minimal local end-to-end completed on 2026-08-23.** The minimum local MCP -> bridge -> Unity -> structured-result path is runtime-verified on Windows / Unity 6000.3.21f1 for editor status, active-scene hierarchy, one bounded GameObject create mutation with duplicate-retry protection, and bounded Console/compiler diagnostics. Phase 2 now focuses on generalizing the reliability guarantees that were only proven on these narrow Phase 1 slices.

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Core design/docs | Implemented | `AGENTS.md`, `DESIGN.md`, `DECISIONS.md`, `ROADMAP.md`, `CODEMAP.md`, `REFERENCES.md`. |
| Unity Editor package scaffold | Verified manually | Package Manager load and Editor assembly compilation passed in Unity 6000.3.21f1 on Windows; all Phase 1 slices subsequently compiled on the same target. |
| Initial Unity target | Verified for Phase 1 | Unity 6000.3.21f1 completed real WebSocket/status, MCP status, reconnect lifecycle, hierarchy read, GameObject create/dedup, diagnostics read, and compiler-error capture. Broader compatibility remains unverified. |
| Bridge protocol v0 | Implemented | Command/result schemas, TypeScript/C# protocol types/constants, fixtures, and operation docs exist. |
| MCP/server scaffold | Verified | Node 24.19.0 install/build/tests pass in GitHub Actions. |
| Local WebSocket bridge server | Verified for Phase 1 slices | Real status, hierarchy, create, and diagnostics requests completed against Unity 6000.3.21f1. |
| Unity outbound WebSocket connection | Verified manually | Real `ClientWebSocket` connection, reconnect after domain reload, and renewed hello succeeded. |
| Unity main-thread dispatcher | Verified for current read/write slices | Real reads and the first write operation completed through the dispatcher-backed Unity main-thread path. |
| `editor.status` / `unity_get_status` | Verified manually | Live Unity version, project, active scene, Play Mode, and compilation state returned through MCP. |
| `scene.hierarchy` / `unity_get_hierarchy` | Verified manually | Live bounded hierarchy returned with `GlobalObjectId`, transient `instanceId`, sibling/depth metadata, and truncation metadata. |
| Hierarchy object identity | Verified for tested saved scene | Returned nodes use Unity `GlobalObjectId` plus transient `instanceId`; unusual/unsaved object cases remain future work. |
| Reconnect / stale-generation lifecycle | Verified manually + CI support | Domain reload preserved editor identity, changed `connectionGeneration`, rejected stale routing with `routing/stale_connection`, and accepted commands on the new generation. |
| `gameObject.create` / `unity_create_game_object` | Verified manually + CI support | One empty root GameObject was created, scene dirtied, Undo registered, and `GlobalObjectId` returned. |
| Mutation retry/dedup protection | Verified for immediate same-session `gameObject.create` retry | First call reported `replayed=false`; identical retry reported `replayed=true`, returned the same `GlobalObjectId`, and hierarchy readback found exactly one object. |
| Diagnostics / `unity_get_diagnostics` | Verified manually + CI support | Bounded Console counts and recent captured logs are returned; compiler diagnostics are captured through `CompilationPipeline` with source location metadata. |
| Compiler error capture | Verified manually | Intentional `CS0103` was captured as severity `error`, file `Assets\\MCPCompileErrorTest.cs`, line `5`, column `21`, with `Assembly-CSharp.dll` assembly path. |
| Console text coverage | Verified with explicit limitation | Recent log text is captured only since the current domain load; current Console counts are read separately. No unsupported/internal `UnityEditor.LogEntries` dependency is used. |
| Undo integration | Verified for bounded GameObject-create slice only | General transaction/rollback policy remains Phase 2 work. |
| Native readback + semantic verification | Planned | Phase 2 priority. Current create dedup cache does not revalidate native state after manual Undo/deletion. |
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
- [x] dependency graph pinned with generated lockfile
- [x] bridge protocol v0 schema exists in source
- [x] executable initial test/check commands exist
- [x] dependency install/build/test recorded as passing
- [x] Unity package load/compile check recorded as passing
- [x] project license selected: Apache-2.0

## Phase 1 implementation target — complete

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

- [x] local WebSocket server + Unity outbound reconnect path
- [x] protocol v0 hello and editor connection generation
- [x] Unity main-thread dispatcher
- [x] `editor.status` + MCP `unity_get_status`
- [x] real Unity hello/status round trip
- [x] real MCP stdio status call
- [x] domain reload reconnection with new connection generation
- [x] stale generation rejection and post-reconnect success

### Hierarchy slice

- [x] `scene.hierarchy` Unity command
- [x] bounded preorder traversal (`maxDepth`, `maxNodes`)
- [x] Unity 6000.3-compatible batched `GlobalObjectId` capture
- [x] MCP `unity_get_hierarchy`
- [x] simulated bridge tests + invalid limit tests
- [x] real Unity compile and live MCP hierarchy read

### First write slice — GameObject create

- [x] `gameObject.create` for one empty root GameObject
- [x] MCP `unity_create_game_object` with `risk=write`
- [x] name/mutation-id validation
- [x] Undo registration and scene dirty marking
- [x] `GlobalObjectId` + transient `instanceId` result
- [x] same-session completed mutation result stored in `SessionState`
- [x] identical mutation replay instead of duplicate execution
- [x] mutation-id conflict rejection
- [x] verifier waits for live Unity readiness
- [x] ambiguous retry reuses the same mutation ID
- [x] real create + identical retry + hierarchy readback PASS

### Diagnostics slice

- [x] `editor.diagnostics` read operation
- [x] MCP `unity_get_diagnostics`
- [x] bounded `maxEntries` and minimum severity inputs
- [x] current Console error/warning/log counts through public Unity API
- [x] recent log capture through `Application.logMessageReceivedThreaded`
- [x] compiler warning/error capture through `CompilationPipeline.assemblyCompilationFinished`
- [x] latest compilation snapshot persisted through domain reload in `SessionState`
- [x] Node routing/result/input-validation tests
- [x] real bounded diagnostics read PASS
- [x] intentional compiler error captured with severity/message/file/line/column metadata

### Phase 1 exit gate

✅ **Passed on 2026-08-23.** A clean Unity 6000.3.21f1 test project demonstrated the minimum local capabilities repeatedly through real MCP-to-Unity paths without freezing the Editor. The final compiler diagnostic check captured an intentional `CS0103` with exact source location metadata.

## Verification log

### 2026-08-22 — Phase 0 / heartbeat / reconnect

```text
Environment: Windows + Unity 6000.3.21f1 and GitHub Actions Node 24.19.0
Observed: package compile PASS; real WebSocket hello/status PASS; real MCP unity_get_status PASS; domain reload reconnect PASS; stale generation rejected; new generation status PASS
Result: PASS
```

### 2026-08-22 — Hierarchy

```text
Node verification revision: 2619472abe97ffe9149e05fbe826936f439d62e2
CI: Node Verification 32568901972 PASS; Phase 1 Local Bridge Verification 32568901982 PASS
Real Unity: initial CS1615 exposed Unity 6000.3 API signature mismatch; fixed by using a preallocated GlobalObjectId[]; package then compiled and live unity_get_hierarchy returned SampleScene hierarchy with non-empty GlobalObjectId values
Result: PASS
```

### 2026-08-23 — First GameObject create + duplicate-retry protection

```text
Verified implementation revision: 2969bcfa379f10498d4b5bac69fb085f209d499d
CI: Node Verification 32606458264 PASS; Phase 1 Local Bridge Verification 32606458269 PASS
Action: npm.cmd --prefix mcp-server run verify:create
Observed: first create replayed=false; identical retry replayed=true; same mutationId and GlobalObjectId; hierarchyMatches=1; one generated object visible in SampleScene
Result: PASS
Notes: first verifier attempt exposed a startup readiness race; verifier was fixed to wait for unity_get_status and reuse the same mutationId for ambiguous retries.
```

### 2026-08-23 — General diagnostics read

```text
Environment: Windows, Unity 6000.3.21f1, Node 24.x, official MCP TypeScript client 2.0.0
Action: npm.cmd --prefix mcp-server run verify:diagnostics
Observed: errors=0, warnings=1, logs=1; isCompiling=false; bounded coverage metadata returned; Unity AI Bridge reconnect warning captured with message and stack trace
Result: PASS
```

### 2026-08-23 — Compiler diagnostic source-location capture

```text
Environment: Windows, Unity 6000.3.21f1, Node 24.x
Action: npm.cmd --prefix mcp-server run verify:compiler-error -> create temporary Assets/MCPCompileErrorTest.cs referencing ThisSymbolDoesNotExist
Observed Console count: errors=1
Observed compiler snapshot: sequence=3, severity=error, CS0103, file=Assets\\MCPCompileErrorTest.cs, line=5, column=21, assemblyPath=Library/ScriptAssemblies/Assembly-CSharp.dll
Observed recent Console capture: matching compiler error message also appeared in recentConsoleEntries
Result: PASS
Cleanup requirement: remove the temporary MCPCompileErrorTest.cs and allow Unity to compile cleanly again.
```

## Phase 2 — Reliability Core focus

Phase 2 begins from the narrow reliability primitives proven during Phase 1 and generalizes them across future write tools.

Priority order:

1. structured scene/state observation and stable object resolution,
2. preflight validation,
3. serialized mutation transaction/Undo grouping,
4. native Unity readback after mutation,
5. semantic verification of intended state,
6. rollback on failed verification and verification of rollback,
7. stale-state/revision handling,
8. compile/domain-reload-safe operation lifecycle,
9. generalized mutation idempotency/retry behavior,
10. Unity EditMode tests for the common execution core.

## Known unknowns / remaining reliability work

- exact `GlobalObjectId` behavior for unsaved/new scene objects and unusual object cases,
- GameObject-create replay after manual deletion/Undo is not yet semantically revalidated,
- mutation dedup persistence across full Unity Editor restart is not provided by current `SessionState`,
- general write serialization/idempotency across future mutation families remains unimplemented,
- recent Console entry text only covers the current domain-load capture window,
- long-term Unity support matrix beyond 6000.3.21f1,
- future multi-editor routing design,
- remote authentication/pairing cryptography,
- public hosting provider,
- ChatGPT integration/submission requirements at implementation time,
- BYO MCP security model and whether it will ship.
