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

**Phase 3 — Useful Unity Editing Core**  
Overall status: **In progress**

Completed milestones:

- **Phase 0 — Foundation:** Verified, completed 2026-08-22.
- **Phase 1 — Minimal Local End-to-End:** Verified, completed 2026-08-23.
- **Phase 2 — Reliability Core:** Verified milestone, completed 2026-08-23 for the tool surface that actually exists at exit.

Phase 2 exit evidence and explicit non-goals are recorded in [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md). Future Phase 3 write families are not automatically covered by Phase 2 merely because the common core exists; each new family must adopt and verify the relevant reliability contracts before being called Verified.

## Current verified environment

- Windows
- Unity **6000.3.21f1**
- Node **24.19.0** in GitHub Actions for the current Node verification workflow
- Bridge protocol v0
- Unity package version 0.0.1 during the current verification series

Broader Unity/OS compatibility is not implied.

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Core design/docs | Implemented | `AGENTS.md`, `DESIGN.md`, `DECISIONS.md`, `ROADMAP.md`, `CODEMAP.md`, `REFERENCES.md`, and phase-specific reliability docs. |
| Unity Editor package scaffold | Verified manually | Package Manager load and Editor assembly compilation passed repeatedly on Unity 6000.3.21f1 / Windows. |
| MCP/server scaffold | Verified | Install/build/tests pass in GitHub Actions on Node 24.19.0. |
| Bridge protocol v0 | Implemented | Source-defined schemas, TypeScript/C# protocol models, fixtures, risk metadata, structured results/errors. |
| Local WebSocket bridge | Verified for current local surface | Real status, hierarchy, diagnostics, resolver, create, save, Transform read/write, GameObject update/delete, Component inspect, reconnect, stale-route, capability-preflight, and deadline behavior exercised against live Unity. |
| Unity outbound WebSocket connection | Verified manually | Real `ClientWebSocket` connection and reconnect after domain reload succeeded. |
| Main-thread dispatcher | Verified for current surface | Current Unity API operations run through the Editor main-thread dispatcher. PR #20 verified an expired queued write is rejected at the execution boundary before its body runs. |
| Current single-editor serialization | Verified for current bridge path | The local Unity receive loop awaits one command handler at a time, dispatcher work executes on the Editor main thread, and the common mutation transaction has a re-entrancy guard. This is not a claim of a future multi-editor/per-target scheduler. |
| `editor.status` / `unity_get_status` | Verified manually | Returns live Unity/project/scene/play/compile state plus Agent version/capabilities and state revision metadata. |
| `scene.hierarchy` / `unity_get_hierarchy` | Verified manually | Returns bounded active-scene hierarchy with `GlobalObjectId`, transient `instanceId`, depth/sibling/active metadata, truncation metadata, and state token. |
| Stable object resolver / `unity_resolve_object` | Verified manually + CI support | Created GameObject re-resolved to the same native target; after Undo the same ID returned `found=false`. |
| Diagnostics / `unity_get_diagnostics` | Verified manually + CI support | Bounded Console counts/recent logs and compiler diagnostics with source location metadata. |
| Agent capability/version preflight | Verified manually + CI support | Non-status tools preflight the operation against current Agent capability metadata and fail closed on missing/legacy metadata. Current verified editing capabilities include `transform.get`, `transform.set`, `gameObject.update`, `gameObject.delete`, and `component.inspect`. |
| State revision / stale-state detection | Verified manually + EditMode | Editor-session epoch + monotonic revision preconditions reject stale writes before mutation. |
| Common mutation preflight | Verified for current Undo-capable writes | Compilation, valid/loaded active scene, expected state token, target validation, and re-entrant mutation exclusion are used by current create/Transform/GameObject editing paths as applicable. |
| Undo transaction grouping | Verified for create + Transform + GameObject update/delete | Common transaction owns/names/collapses Undo groups. Verified Undo removed create, restored Transform, restored GameObject update state, and restored a deleted GameObject. |
| Native readback + semantic verification | Verified for create + Transform + GameObject update/delete | Create re-resolves native identity; Transform reads back local TRS; GameObject update verifies name/active state; GameObject delete verifies the target no longer resolves. |
| Rollback on failed verification | Verified | Forced verifier failure reverted the current Undo transaction. |
| Rollback verification | Verified for bounded probe and current mutation contracts | Native resolver/hierarchy verified target absence for the original probe; operation-specific verifiers cover Transform restoration and GameObject update/delete restoration contracts. |
| Mutation lifecycle across script/domain reload | Verified manually + EditMode | Same-session `SessionState` lifecycle survives real domain reload; ambiguous `started` retry fails closed. Full Editor restart persistence is not provided. |
| `gameObject.create` / `unity_create_game_object` | Verified manually + CI support | Root GameObject create, Undo/dirty behavior, native readback, same-id replay, stale-target replay rejection, stale-state rejection. |
| GameObject update / `gameObject.update` / `unity_update_game_object` | Verified manually + CI support | PR #23: complete desired `name` + `activeSelf`, fresh state precondition, no-op handling, Undo, native readback, same-id replay, Undo restoration, and stale replay rejection. |
| GameObject delete / `gameObject.delete` / `unity_delete_game_object` | Verified manually + CI support | PR #23: active-scene target deletion through Unity Undo, native absence verification, same-id replay while absent, Undo restoration of the target, stale replay rejection after restoration, and verifier cleanup. |
| Transform read / `transform.get` / `unity_get_transform` | Verified manually + CI support | PR #22 returned local/world position, local/world rotation, local Euler representation, local/lossy scale, scene/hierarchy metadata, dirty state, and fresh state token for a `GlobalObjectId` GameObject target. |
| Transform write / `transform.set` / `unity_set_transform` | Verified manually + CI support | PR #22 set full local position/Euler/scale with required state precondition, Undo grouping, native readback, Quaternion-equivalent rotation verification, same-id replay, Undo restoration, stale replay rejection, and verifier cleanup. |
| Component inspect / `component.inspect` / `unity_get_components` | Verified manually + CI support | PR #24: bounded native-order Component enumeration including Missing Script slots; visible `SerializedObject`/`SerializedProperty` snapshots; Component `GlobalObjectId`; Transform serialized paths; resolver ownership check; explicit truncation metadata; automatic verifier cleanup. |
| Mutation retry/dedup protection | Verified for current writes | `gameObject.create`, `scene.save`, `transform.set`, `gameObject.update`, and `gameObject.delete` use mutation identity and same-session replay rules. Undo/change after completion causes stale replay to fail closed instead of silently reapplying/redeleting state. |
| Dirty-state outcome reporting | Verified | PR #18 proved the transaction reports `sceneWasDirtyBefore`, `sceneIsDirtyAfter`, `dirtyStateChanged`, and `rollbackDirtyResidue`. A clean scene can remain dirty after successful object rollback; this is reported rather than hidden. |
| Dirty-state restoration | Not implemented | Unity can leave a previously clean scene dirty after Undo rollback. Phase 2 does not claim that dirty metadata is restored. |
| Explicit save / `scene.save` / `unity_save_active_scene` | Verified manually + CI support | PR #19: explicit destructive save to existing active-scene path only; exact path/state preconditions; native clean/file readback; same-id replay; stale pre-save token rejected. |
| Write execution deadline | Verified manually + EditMode | PR #20: receive-time check plus execution-boundary recheck for write/destructive work. Real queued-expiry self-test reported `expiredBeforeExecution=true`, `actionExecuted=false`. Current Transform and GameObject writes use the same execution-boundary deadline path. |
| In-flight Unity API cancellation | Not implemented by design | A Unity API call already started before deadline is not force-interrupted. Ambiguous outcome handling relies on mutation lifecycle + mutation identity/reconciliation rather than unsafe mid-API interruption. |
| Unity EditMode reliability/editing suite | Verified manually | Suite grew 8/8 (#16) -> 12/12 (#17) -> 14/14 (#18) -> 16/16 (#19) -> 19/19 (#20) -> 23/23 (#22) -> 29/29 (#23) -> **33/33 (#24)** on Unity 6000.3.21f1. Non-embedded package installs require the package name in the consuming project's `Packages/manifest.json` `testables`. |
| Remote gateway / Easy Connect | Planned | Not implemented. |
| Pairing/authentication | Planned | Not implemented. |
| Multi-user/editor routing | Planned | Local bridge intentionally supports one active editor only. |
| ChatGPT integration | Planned | Not implemented or submitted. |

## Phase 0 — Foundation

✅ **Completed 2026-08-22.**

Verified/implemented foundation includes repository boundaries, contributor/AI grounding rules, architecture and decisions, public roadmap, provenance rules, Unity target selection, source scaffold, pinned Node dependency graph, bridge protocol v0, initial CI, Unity package load/compile, and Apache-2.0 public-core licensing.

## Phase 1 — Minimal Local End-to-End

✅ **Completed 2026-08-23.**

Verified minimum flow:

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

Verified minimum capabilities:

- editor status,
- active-scene hierarchy,
- one empty root GameObject create mutation,
- mutation ID replay protection,
- bounded Console/compiler diagnostics,
- real compiler error source-location capture,
- domain-reload reconnect and stale connection-generation rejection.

Compiler diagnostic verification captured intentional `CS0103` for `Assets/MCPCompileErrorTest.cs`, line 5, column 21. That temporary test file must not remain in a normal consuming project.

## Phase 2 — Reliability Core

✅ **Completed 2026-08-23 for the current implemented surface.**

Verified slices:

- [x] PR #10 — stable native resolver, create readback, stale replay rejection
- [x] PR #11 — Agent version/capability metadata + MCP capability preflight
- [x] PR #12 — common mutation preflight + Undo transaction core
- [x] PR #13 — forced semantic-verification failure + actual Undo rollback
- [x] PR #14 — state epoch/revision + stale-state write rejection
- [x] PR #15 — same-session mutation lifecycle surviving real domain reload
- [x] PR #16 — first EditMode reliability suite; 8/8
- [x] PR #17 — structured verification/rollback-verification contract; 12/12
- [x] PR #18 — dirty-state reporting; 14/14
- [x] PR #19 — explicit active-scene save; 16/16
- [x] PR #20 — write/destructive execution-boundary deadlines; 19/19

See [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md) for the exit-gate mapping and explicit limitations.

### Phase 2 exit decision

The existing local surface demonstrates that normal reconnect/domain reload, stale state, unsupported Agent capability skew, duplicate delivery, failed verification/rollback, explicit persistence, and queued deadline expiry do not silently duplicate the current mutations or claim success without the expected evidence.

Phase 2 completion does **not** pre-verify future Phase 3 mutation families. New writes must adopt the common reliability contracts individually.

## Verification highlights

### Local heartbeat / reconnect

```text
Environment: Windows + Unity 6000.3.21f1
Observed: real WebSocket hello/status PASS; MCP unity_get_status PASS; domain reload reconnect PASS; stale generation rejected; new-generation status PASS
Result: PASS
```

### Hierarchy

```text
Observed: live SampleScene hierarchy returned with non-empty GlobalObjectId metadata after fixing a Unity 6000.3 API signature mismatch.
Result: PASS
```

### First create + replay

```text
Observed: first create replayed=false; identical same-id retry replayed=true; native/hierarchy readback matched one object.
Result: PASS
```

### Diagnostics

```text
Observed: bounded Console counts/recent entries plus compiler snapshot; intentional CS0103 returned severity/message/file/line/column metadata.
Result: PASS
```

### Stable resolver + stale replay

```text
Observed: resolver found the created target; after one Undo found=false; same mutationId retry failed stale_target/mutation_replay_stale; hierarchyMatches=0.
Result: PASS
```

### State revision

```text
Observed: fresh state accepted one write; second different write with the stale token was rejected before mutation; rejectedHierarchyMatches=0.
Result: PASS
```

### Domain-reload lifecycle

```text
Observed: lifecycleStatus=started survived real script/domain reload; domainChanged=true; same mutationId retryRejected=true; hierarchyMatches=0.
Result: PASS
```

### Structured rollback verification

```text
Observed: forcedVerificationFailure=true; changed=true; verified=false; rolledBack=true; rollbackVerifierCalled=true; rollbackVerified=true; rollback target absent; hierarchyMatches=0.
Result: PASS
```

### Dirty-state policy

```text
Saved/clean scene before probe: sceneWasDirtyBefore=false
After verified object rollback: sceneIsDirtyAfter=true; dirtyStateChanged=true; rollbackDirtyResidue=true
Result: PASS for explicit reporting; dirty metadata restoration is not implemented.
```

### Explicit scene save

```text
Initial revision=45
Save: replayed=false; saved=true; wasDirty=true; isDirty=false; revision 45 -> 46
Same-id retry: replayed=true; remained clean at revision 46
New save with old revision 45: stale_state/state_revision_mismatch
Result: PASS
```

### Execution-boundary deadline

```text
Self-test: queued 75 ms blocker ahead of 10 ms-deadline guarded action
Observed: expiredBeforeExecution=true; actionExecuted=false
EditMode: 19 Passed / 0 Failed
Result: PASS
```

### Phase 3 Transform read/write (PR #22)

```text
Environment: Windows + Unity 6000.3.21f1
CI: Node Verification 32619697919 PASS; Phase 1 Local Bridge Verification 32619697897 PASS
EditMode: 23 Passed / 0 Failed
Target: GlobalObjectId_V1-2-99c9720ab356a0642a771bea13969a05-1006617028-0
Initial local TRS: position=(0,0,0), Euler=(0,0,0), scale=(1,1,1)
Requested local TRS: position=(1.25,-2.5,3.75), Euler=(15,30,45), scale=(1.5,0.75,2)
Observed: native readback matched requested position/scale and Quaternion-equivalent rotation; immediate same-id replay=true; one Undo restored initial Transform; same mutation retry after Undo failed stale_target/mutation_replay_stale; second Undo removed the temporary object
Verifier summary: writeVerified=true; immediateReplay=true; undoRestoredInitialTransform=true; temporaryObjectRemoved=true
Result: PASS
```

### Phase 3 GameObject update/delete (PR #23)

```text
Environment: Windows + Unity 6000.3.21f1
CI: Node Verification 32620455952 PASS; Phase 1 Local Bridge Verification 32620455981 PASS
EditMode: 29 Passed / 0 Failed
Target: GlobalObjectId_V1-2-99c9720ab356a0642a771bea13969a05-1454343624-0
Update: updateVerified=true; updateReplay=true; updateUndoRestored=true; retry after Undo -> stale_target/mutation_replay_stale
Delete: deleteVerified=true; deleteReplay=true; deleteUndoRestored=true; retry after Undo -> stale_target/mutation_replay_stale
Cleanup: cleanupDeleted=true
Result: PASS
```

### Phase 3 Component inspection (PR #24)

```text
Environment: Windows + Unity 6000.3.21f1
CI latest pre-doc head: Node Verification 32622017786 PASS; Phase 1 Local Bridge Verification 32622017813 PASS
EditMode: 33 Passed / 0 Failed
GameObject: GlobalObjectId_V1-2-99c9720ab356a0642a771bea13969a05-2044531344-0
Transform Component: GlobalObjectId_V1-2-99c9720ab356a0642a771bea13969a05-2044531345-0
Observed Transform serialized paths: m_LocalRotation, m_LocalPosition, m_LocalScale and child scalar paths, plus m_ConstrainProportionsScale
Resolver: componentResolved=true; ownerMatches=true
Cleanup: cleanupDeleted=true; temporaryObjectRemoved=true
Initial test-only all-zero GlobalObjectId fixture was rejected by Unity 6000.3; fixture changed to a parseable non-zero GUID and the corrected suite passed 33/33. Production Component inspection code was unchanged by that correction.
Result: PASS
```

## Phase 3 — Useful Unity Editing Core

Current objective: add a small, useful editing surface without bypassing the reliability rules proven in Phase 2.

Verified Phase 3 slices:

1. **Transform read/update for a resolved GameObject — Verified.**
   - `unity_get_transform`
   - `unity_set_transform`
   - complete local position/Euler/scale write contract
   - native semantic readback
   - Undo restoration
   - same-id replay + stale replay rejection
   - 23/23 EditMode suite on Unity 6000.3.21f1

2. **GameObject update/delete — Verified.**
   - `unity_update_game_object`
   - `unity_delete_game_object`
   - update name + `activeSelf` with native verification
   - Undo-capable hierarchy deletion with native absence verification
   - same-id replay + stale replay rejection after Undo
   - verifier cleanup
   - 29/29 EditMode suite on Unity 6000.3.21f1

3. **Component inspection — Verified.**
   - `unity_get_components`
   - bounded native-order Component enumeration including Missing Script slots
   - Component `GlobalObjectId`, type/assembly/script metadata
   - visible `SerializedObject` / `SerializedProperty` snapshot instead of unrestricted reflection
   - explicit component/property/depth truncation metadata
   - resolver ownership verification for returned Transform Component ID
   - automatic verifier cleanup
   - 33/33 EditMode suite on Unity 6000.3.21f1

Next candidates:

1. component add/remove/edit,
2. asset search/inspect,
3. prefab workflows,
4. script workflows,
5. Play Mode and Test Runner controls.

No arbitrary C# execution fallback is planned for these capabilities.

## Known limitations / future work

- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized.
- `SessionState` mutation lifecycle does not survive a full Unity Editor restart.
- Clean-scene dirty metadata restoration after Undo rollback is not implemented.
- An already-started Unity API call is not force-cancelled when deadline later expires.
- Component inspection now provides a bounded visible serialized-property snapshot; Component add/remove/edit and their operation-specific semantic verifiers remain future Phase 3 work.
- Asset snapshots/search remain unimplemented.
- Current Transform write targets a GameObject `GlobalObjectId` and deliberately does not silently reinterpret a Component ID as its owner GameObject.
- GameObject delete is classified destructive because it removes hierarchy state, but the current active-scene implementation records Unity Undo and was verified to restore the deleted target through Undo.
- Recent Console text covers only the current domain-load capture window.
- Unity support beyond 6000.3.21f1 is unverified.
- Multi-editor routing, remote authentication/pairing, remote gateway hosting, and ChatGPT submission/integration remain later-phase work.
