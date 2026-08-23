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

**Phase 1 — Minimal Local End-to-End completed on 2026-08-23.** The minimum local MCP -> bridge -> Unity -> structured-result path is runtime-verified on Windows / Unity 6000.3.21f1 for editor status, active-scene hierarchy, one bounded GameObject create mutation with duplicate-retry protection, and bounded Console/compiler diagnostics.

Phase 2 has since verified stable native object resolution, Agent capability preflight, a common mutation preflight/Undo transaction core, forced-failure rollback, stale-state revision rejection, same-session domain-reload mutation lifecycle protection, and the first Unity EditMode regression tests. These guarantees are still proven mainly through the bounded `gameObject.create` path and must be generalized across future write families before Phase 2 exits.

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Core design/docs | Implemented | `AGENTS.md`, `DESIGN.md`, `DECISIONS.md`, `ROADMAP.md`, `CODEMAP.md`, `REFERENCES.md`. |
| Unity Editor package scaffold | Verified manually | Package Manager load and Editor assembly compilation passed in Unity 6000.3.21f1 on Windows; subsequent Phase 1/2 slices compiled on the same target. |
| Initial Unity target | Verified for current local slices | Unity 6000.3.21f1 completed real status, hierarchy, diagnostics, stable resolver, create/readback/replay, capability preflight, transaction/rollback, stale-state, domain-reload lifecycle, and EditMode test verification. Broader compatibility remains unverified. |
| Bridge protocol v0 | Implemented | Command/result schemas, TypeScript/C# protocol types/constants, fixtures, and operation docs exist. |
| MCP/server scaffold | Verified | Node 24.19.0 install/build/tests pass in GitHub Actions. |
| Local WebSocket bridge server | Verified for current local slices | Real status, hierarchy, create, diagnostics, object-resolve, capability-preflighted reads, reconnect, and stale-route behavior completed against Unity 6000.3.21f1. |
| Unity outbound WebSocket connection | Verified manually | Real `ClientWebSocket` connection, reconnect after domain reload, and renewed hello succeeded. |
| Unity main-thread dispatcher | Verified for current read/write slices | Current bridge operations are queued to the Editor main thread. The queue and common mutation guard prevent simultaneous execution in the verified single-editor path; richer conflict scheduling is future work. |
| `editor.status` / `unity_get_status` | Verified manually | Live Unity version, project, active scene, Play Mode, compilation state, Agent version, capabilities, and state revision metadata are returned. |
| `scene.hierarchy` / `unity_get_hierarchy` | Verified manually | Live bounded hierarchy returned with `GlobalObjectId`, transient `instanceId`, sibling/depth metadata, truncation metadata, and state revision metadata. |
| Hierarchy object identity | Verified for tested saved scene | Returned nodes use Unity `GlobalObjectId` plus transient `instanceId`; unusual/unsaved object cases remain future work. |
| Stable object resolver / `unity_resolve_object` | Verified manually + CI support | A created GameObject was re-resolved from its `GlobalObjectId` to the same native object/type/scene/name/instance metadata; after Undo, the same identifier returned `found=false`. |
| Reconnect / stale-generation lifecycle | Verified manually + CI support | Domain reload preserved editor identity, changed `connectionGeneration`, rejected stale routing with `routing/stale_connection`, and accepted commands on the new generation. |
| Unity Agent capability/version negotiation | Verified manually + CI support | `editor.status` advertises `agentVersion=0.0.1` plus supported operations. Non-status MCP tools preflight the required operation; missing/legacy capability metadata fails before dispatch. |
| `gameObject.create` / `unity_create_game_object` | Verified manually + CI support | One empty root GameObject is created through the common transaction core, scene dirtying/Undo is registered, `GlobalObjectId` is returned, and native readback verifies the requested identity before success is cached. |
| Common mutation preflight | Verified for current write slice | Common checks cover compilation, valid/loaded active scene, optional expected state epoch/revision, and re-entrant mutation exclusion. |
| Undo transaction grouping | Verified for current write slice | Common transaction opens/names/collapses an Undo group; one Ctrl+Z removes the verified create result. |
| Mutation retry/dedup protection | Verified for same-session `gameObject.create` | Immediate identical retry returns `replayed=true` without duplication. A replay whose cached target was Undone/deleted fails closed as `stale_target/mutation_replay_stale`. |
| Native readback + semantic verification | Verified for bounded create identity/existence | First create is re-resolved through native Unity state before success is cached. Broader property/component/asset semantic verification remains future work. |
| Rollback on failed verification | Verified for common transaction probe | A deliberate verifier failure after creating a temporary object triggered `Undo.RevertAllInCurrentGroup`; native resolver and hierarchy then confirmed the object was gone. |
| Rollback verification | Verified for bounded probe only | Resolver returned `found=false` and hierarchy matched zero rollback-probe objects. A reusable rollback-verification contract is not yet implemented. |
| State revision / stale-state detection | Verified manually + EditMode tests | State is identified by per-Editor-session epoch + monotonic revision. Fresh state allowed one write; a different write using the stale token was rejected as `stale_state/state_revision_mismatch` before creating an object. |
| Mutation lifecycle across compilation/domain reload | Verified manually + EditMode tests | `SessionState` lifecycle records mark `started` before mutation. A real domain reload preserved an ambiguous `started` record; retrying the same mutationId failed closed and created no object. Full Editor restart persistence is not provided. |
| Unity EditMode reliability tests | Verified manually | `EunSung.UnityAiBridge.Editor.Tests` ran **8 Passed / 0 Failed** on Windows / Unity 6000.3.21f1: 4 state-revision tests + 4 mutation-lifecycle tests. Non-embedded package installs require the package in project `manifest.json` `testables`. |
| Scene dirty-state policy | In progress | Create marks/reports dirty. Rollback was tested while the scene was already dirty (`sceneWasDirty=True`, `sceneIsDirty=True`), so clean-scene dirty restoration remains unverified. |
| Explicit save behavior | Planned | No write silently saves. An explicit save contract/tool is not yet implemented. |
| Timeout/cancellation reconciliation | In progress | Deadlines/timeouts exist. Generalized cancellation/reconciliation for writes is not yet verified. |
| Diagnostics / `unity_get_diagnostics` | Verified manually + CI support | Bounded Console counts/recent captured logs are returned; compiler diagnostics are captured through `CompilationPipeline` with source location metadata. |
| Compiler error capture | Verified manually | Intentional `CS0103` was captured as severity `error`, file `Assets\\MCPCompileErrorTest.cs`, line `5`, column `21`, with `Assembly-CSharp.dll` assembly path. |
| Console text coverage | Verified with explicit limitation | Recent log text is captured only since current domain load; current Console counts are read separately. No unsupported/internal `UnityEditor.LogEntries` dependency is used. |
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

## Phase 2 verified slices

Phase 2 evidence is intentionally recorded as bounded slices rather than claiming the entire reliability core is complete.

- [x] PR #10 — stable native object resolver, create native readback, stale replay rejection
- [x] PR #11 — Agent version/capability metadata and MCP capability preflight
- [x] PR #12 — common mutation preflight + Undo transaction core
- [x] PR #13 — forced semantic-verification failure and actual Undo rollback probe
- [x] PR #14 — state epoch/revision tokens and stale-state write rejection
- [x] PR #15 — mutation lifecycle ledger surviving real same-session script/domain reload
- [x] PR #16 — first Unity EditMode reliability test assembly; 8/8 tests passed

Current next reliability slice: **generalized semantic verification + rollback verification outcome contract**, followed by explicit save/dirty-state semantics and cancellation reconciliation.

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

### 2026-08-23 — Stable object resolver + stale mutation replay (PR #10)

```text
Environment: Windows, Unity 6000.3.21f1, official MCP TypeScript client 2.0.0
Action: npm.cmd --prefix mcp-server run verify:resolver
Observed: create replayed=false; native resolver found=true and matched canonical GlobalObjectId/instance/name/scene/type; after one Ctrl+Z resolver found=false; same mutation retry returned stale_target/mutation_replay_stale; hierarchyMatches=0
Result: PASS
```

### 2026-08-23 — Agent capability preflight (PR #11)

```text
Environment: Windows, Unity 6000.3.21f1
Action: npm.cmd --prefix mcp-server run verify:capabilities
Observed: agentVersion=0.0.1; capabilities included editor.status, scene.hierarchy, editor.diagnostics, object.resolve, gameObject.create; capability-preflighted scene.hierarchy call passed
Result: PASS
```

### 2026-08-23 — Common mutation transaction (PR #12)

```text
Environment: Windows, Unity 6000.3.21f1
Action: npm.cmd --prefix mcp-server run verify:resolver
Observed: first create native readback PASS; immediate identical replay replayed=true; one Ctrl+Z removed the transaction-created object; stale replay was rejected; hierarchyMatches=0
Result: PASS
```

### 2026-08-23 — Transaction rollback probe (PR #13)

```text
Environment: Windows, Unity 6000.3.21f1
Action: Tools -> Unity AI Bridge -> Verify Transaction Rollback
Observed: forcedVerificationFailure=true; rollbackTargetFound=false; hierarchyMatches=0; sceneWasDirty=True; sceneIsDirty=True
Result: PASS for object rollback; clean-scene dirty-flag restoration remains unverified
```

### 2026-08-23 — State revision / stale-state rejection (PR #14)

```text
Environment: Windows, Unity 6000.3.21f1
Action: npm.cmd --prefix mcp-server run verify:state-revision
Observed: initial state epoch b2ff69f157034d1caebb3c3eb104e67e revision 1; fresh write accepted; response revision 2; different write reusing stale revision 1 rejected as stale_state/state_revision_mismatch before creation; rejectedHierarchyMatches=0; after one Ctrl+Z revision=4 and acceptedHierarchyMatchesAfterUndo=0
Result: PASS
Notes: revision is an opaque freshness detector; conservative observers may advance it more than once for one logical edit.
```

### 2026-08-23 — Mutation lifecycle across real domain reload (PR #15)

```text
Environment: Windows, Unity 6000.3.21f1
Action: Tools -> Unity AI Bridge -> Verify Mutation Lifecycle Reload Safety
Observed after actual compilation/domain reload: lifecycleStatus=started; domainChanged=true; retryRejected=true; hierarchyMatches=0; same mutationId was not re-executed
Result: PASS
Limitation: SessionState does not provide full Editor-restart durability.
```

### 2026-08-23 — Unity EditMode reliability tests (PR #16)

```text
Environment: Windows, Unity 6000.3.21f1, Unity Test Runner EditMode
Setup note: non-embedded local package required com.eunsung.unity-ai-bridge in Packages/manifest.json testables
Observed: EunSung.UnityAiBridge.Editor.Tests loaded; 8 Passed / 0 Failed
Coverage: 4 state-revision tests + 4 mutation-lifecycle fail-closed tests
Result: PASS
```

## Phase 2 — Reliability Core focus

Completed/verified bounded primitives:

1. stable object resolution,
2. Agent capability preflight,
3. common mutation preflight,
4. Undo transaction grouping,
5. native create readback,
6. bounded semantic verification,
7. forced-failure rollback,
8. bounded native rollback verification,
9. stale-state revision handling,
10. compile/domain-reload-safe mutation lifecycle,
11. initial Unity EditMode regression tests.

Current priority order:

1. generalized semantic verification outcome contract,
2. generalized rollback verification outcome contract,
3. explicit save and clean-scene dirty-state semantics,
4. cancellation/reconciliation behavior,
5. broader write-family adoption and EditMode coverage.

## Known unknowns / remaining reliability work

- exact `GlobalObjectId` behavior for unsaved/new scene objects and unusual object cases,
- mutation dedup/lifecycle persistence across a full Unity Editor restart is not provided by current `SessionState`,
- generalized verification/rollback outcome semantics across future mutation families,
- clean-scene dirty-flag behavior after a failed mutation rollback,
- explicit save contract and verification,
- generalized cancellation/reconciliation for ambiguous writes,
- richer per-target conflict scheduling beyond the current single main-thread mutation queue/guard,
- recent Console entry text only covers the current domain-load capture window,
- long-term Unity support matrix beyond 6000.3.21f1,
- future multi-editor routing design,
- remote authentication/pairing cryptography,
- public hosting provider,
- ChatGPT integration/submission requirements at implementation time,
- BYO MCP security model and whether it will ship.
