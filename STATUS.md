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
| Stable object resolver / `unity_resolve_object` | Implemented + Node verified; Unity runtime verification pending | Branch `phase2/stable-object-resolver` implements `object.resolve` using `GlobalObjectId` native resolution. First real verifier attempt reached an older compiled Unity Agent that returned `unsupported/operation_not_supported` for `object.resolve`; branch source inspection confirmed the dispatcher route exists, so this is currently classified as package/domain version skew. Reimport/recompile/restart and rerun are required before marking Verified. |
| Native readback + stale mutation replay protection | Implemented + Node verified; Unity runtime verification pending | New create path native-readbacks the created `GlobalObjectId`; cached replay re-resolves and fails closed with `stale_target/mutation_replay_stale` if the target no longer matches. Real Undo/stale-replay verification is pending. |
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

### Phase 1 exit gate

✅ **Passed on 2026-08-23.** A clean Unity 6000.3.21f1 test project demonstrated the minimum local capabilities repeatedly through real MCP-to-Unity paths without freezing the Editor. The final compiler diagnostic check captured an intentional `CS0103` with exact source location metadata.

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

### Current Phase 2 slice — stable resolver/native readback

- [x] source implementation of `ObjectResolverCommand`
- [x] bridge `object.resolve`
- [x] MCP `unity_resolve_object`
- [x] Node payload/routing/input-validation tests
- [x] native readback added to first-time GameObject create
- [x] cached mutation replay revalidates native target
- [x] stale cached replay maps to `stale_target/mutation_replay_stale`
- [x] CI build/tests pass
- [ ] Unity 6000.3.21f1 recompiles the new Phase 2 Agent source
- [ ] live resolver returns matching native metadata
- [ ] Ctrl+Z causes resolver `found=false`
- [ ] identical stale mutation replay is rejected and does not recreate the object
- [ ] hierarchy readback confirms zero replacement objects

### Runtime finding — 2026-08-23

```text
Action: npm.cmd --prefix mcp-server run verify:resolver
Observed: MCP server advertised unity_resolve_object, but connected Unity Agent returned unsupported/operation_not_supported for bridge operation object.resolve.
Repository check: phase2/stable-object-resolver source contains the object.resolve dispatcher route.
Classification: Unity package/domain version skew; connected Editor was running an older compiled Unity AI Bridge assembly.
Result: FAIL (environment/runtime reload issue, not proof of missing source implementation)
Recovery: pull latest branch, force Reimport/Refresh/domain reload or restart Unity, confirm no compile errors, rerun verify:resolver.
```

## Known unknowns / remaining reliability work

- exact `GlobalObjectId` behavior for unsaved/new scene objects and unusual object cases,
- connected Unity Agent capability/version negotiation is not yet explicit in the hello contract; the runtime version-skew finding above shows why it should be added to Phase 2,
- mutation dedup persistence across full Unity Editor restart is not provided by current `SessionState`,
- general write serialization/idempotency across future mutation families remains unimplemented,
- recent Console entry text only covers the current domain-load capture window,
- long-term Unity support matrix beyond 6000.3.21f1,
- future multi-editor routing design,
- remote authentication/pairing cryptography,
- public hosting provider,
- ChatGPT integration/submission requirements at implementation time,
- BYO MCP security model and whether it will ship.
