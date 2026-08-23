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
- **Phase 2 — Reliability Core:** Verified milestone, completed 2026-08-23 for the tool surface that existed at exit.

Phase 2 exit evidence and explicit non-goals are recorded in [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md). Future write families are not automatically covered merely because the common reliability core exists; each write family must adopt and verify the relevant contracts individually.

## Current verified environment

- Windows
- Unity **6000.3.21f1**
- Node **24.19.0** in GitHub Actions for the current Node verification workflow
- Bridge protocol v0
- Unity package version 0.0.1 during the current verification series

Broader Unity/OS compatibility is not implied.

## Current verified surface

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Unity Editor package scaffold | Verified manually | Package Manager load and Editor assembly compilation passed repeatedly on Unity 6000.3.21f1 / Windows. |
| MCP/server scaffold | Verified | Install/build/tests pass in GitHub Actions on Node 24.19.0. |
| Bridge protocol v0 | Implemented | Source-defined schemas, TypeScript/C# protocol models, fixtures, risk metadata, structured results/errors. |
| Local WebSocket bridge | Verified for current local surface | Real status, hierarchy, diagnostics, resolver, scene save, Transform, GameObject, Component, AssetDatabase reads, reconnect, stale-route, capability-preflight, and deadline behavior exercised against live Unity. |
| Unity outbound WebSocket connection | Verified manually | Real `ClientWebSocket` connection and reconnect after domain reload succeeded. |
| Main-thread dispatcher | Verified for current surface | Current Unity API operations run through the Editor main-thread dispatcher. PR #20 proved expired queued writes are rejected before the mutation body runs. |
| Current single-editor serialization | Verified for current bridge path | Local receive handling awaits one command at a time, dispatcher work executes on the Editor main thread, and the common mutation transaction has a re-entry guard. This is not a future multi-editor/per-target scheduler claim. |
| `editor.status` / `unity_get_status` | Verified manually | Live Unity/project/scene/play/compile state plus Agent version/capabilities and scene-state revision metadata. |
| `scene.hierarchy` / `unity_get_hierarchy` | Verified manually | Bounded active-scene hierarchy with `GlobalObjectId`, transient `instanceId`, hierarchy metadata, truncation metadata, and state token. |
| `object.resolve` / `unity_resolve_object` | Verified manually + CI support | Native target re-resolution; Undo/deletion returns `found=false` instead of inventing a replacement. |
| `editor.diagnostics` / `unity_get_diagnostics` | Verified manually + CI support | Bounded Console counts/recent logs and compiler diagnostics with source location metadata. |
| Agent capability/version preflight | Verified manually + CI support | Non-status tools fail closed on missing/legacy capability metadata. Current verified capabilities include scene/object diagnostics, Transform, GameObject, Component, explicit scene save, and AssetDatabase read operations. |
| State revision / stale-state detection | Verified manually + EditMode | Editor-session epoch + monotonic revision preconditions reject stale scene writes before mutation. Asset reads deliberately do not pretend this scene token is an asset-state token. |
| Common mutation preflight | Verified for current Undo-capable writes | Compilation, valid/loaded active scene, state token where required, target validation, and re-entrant mutation exclusion. |
| Undo transaction grouping | Verified for create + Transform + GameObject + Component writes | Verified Undo removes/restores the intended operation-specific state. |
| Native readback + semantic verification | Verified for current writes | Create, Transform, GameObject update/delete, Component add/remove, and supported Component property writes use operation-specific native readback. |
| Rollback on failed verification | Verified | Forced verifier failure reverted the current Undo transaction. |
| Rollback verification | Verified for bounded probe and current mutation contracts | Operation-specific rollback verifiers confirm expected native restoration/absence. |
| Mutation lifecycle across script/domain reload | Verified manually + EditMode | Same-session `SessionState` lifecycle survives real domain reload; ambiguous `started` retry fails closed. Full Editor restart persistence is not provided. |
| Mutation retry/dedup protection | Verified for current writes | Create, scene save, Transform, GameObject, Component add/remove/property writes use mutation identity and same-session replay rules. Undo/change after completion causes stale replay failure instead of silent reapplication. |
| Dirty-state outcome reporting | Verified | Clean-scene rollback can leave Unity dirty metadata; the bridge reports this explicitly instead of hiding it. |
| Dirty-state restoration | Not implemented | A previously clean scene can remain dirty after an Undo-based rollback. |
| Explicit scene save / `unity_save_active_scene` | Verified manually + CI support | Existing saved active-scene path only; exact path/state preconditions; native clean/file verification; replay and stale-state protection. |
| Write execution deadline | Verified manually + EditMode | Receive-time and execution-boundary checks prevent a queued expired write from beginning. |
| In-flight Unity API cancellation | Not implemented by design | An already-started Unity API call is not force-interrupted; mutation identity/lifecycle handle ambiguous outcomes. |
| Asset search / `asset.search` / `unity_search_assets` | Verified manually + CI support | PR #27: bounded Unity `AssetDatabase.FindAssets` search, deterministic path ordering, `Assets`/`Packages` scope validation, SceneAsset live verification. |
| Asset inspect / `asset.inspect` / `unity_inspect_asset` | Verified manually + CI support | PR #27: exact asset-file inspection returning GUID/path/main type/importer/labels, `GetAssetDependencyHash`, bounded direct dependencies; folder paths fail closed. |
| Remote gateway / Easy Connect | Planned | Not implemented. |
| Pairing/authentication | Planned | Not implemented. |
| Multi-user/editor routing | Planned | Local bridge intentionally supports one active editor only. |
| ChatGPT integration | Planned | Not implemented or submitted. |

## Phase 0 — Foundation

✅ **Completed 2026-08-22.**

Verified/implemented foundation includes repository boundaries, contributor/AI grounding rules, architecture and decisions, provenance rules, Unity target selection, source scaffold, pinned Node dependency graph, bridge protocol v0, initial CI, Unity package load/compile, and Apache-2.0 public-core licensing.

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

Verified minimum capabilities included editor status, hierarchy, empty root GameObject creation, mutation replay protection, diagnostics, real compiler source-location capture, and domain-reload reconnect/stale-generation rejection.

## Phase 2 — Reliability Core

✅ **Completed 2026-08-23 for the implemented surface at exit.**

Verified slices:

- [x] PR #10 — stable resolver / create native readback / stale replay
- [x] PR #11 — Agent version/capability metadata + MCP preflight
- [x] PR #12 — common mutation preflight + Undo transaction core
- [x] PR #13 — forced semantic-verification failure + real rollback
- [x] PR #14 — state epoch/revision + stale-state rejection
- [x] PR #15 — same-session lifecycle surviving domain reload
- [x] PR #16 — EditMode reliability suite 8/8
- [x] PR #17 — structured verification/rollback-verification 12/12
- [x] PR #18 — dirty-state reporting 14/14
- [x] PR #19 — explicit active-scene save 16/16
- [x] PR #20 — write execution-boundary deadlines 19/19

See [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md) for the detailed exit mapping and limitations.

## Phase 3 — Useful Unity Editing Core

Current objective: provide a small but genuinely useful Unity editing/inspection surface without arbitrary code execution while retaining the reliability rules proven in Phase 2.

### Verified slices

1. **Transform read/update — PR #22**
   - `unity_get_transform`, `unity_set_transform`
   - full local position/Euler/scale write contract
   - Quaternion-equivalent rotation verification
   - same-id replay, Undo restoration, stale-replay rejection, cleanup
   - **23/23 EditMode** on Unity 6000.3.21f1

2. **GameObject update/delete — PR #23**
   - `unity_update_game_object`, `unity_delete_game_object`
   - native name/active-state and deletion verification
   - same-id replay, Undo restoration, stale-replay rejection, cleanup
   - **29/29 EditMode**

3. **Component inspection — PR #24**
   - `unity_get_components`
   - bounded native-order Component enumeration including Missing Script slots
   - Component `GlobalObjectId`, type/assembly/script metadata
   - visible `SerializedObject` / `SerializedProperty` snapshots
   - resolver ownership verification and cleanup
   - **33/33 EditMode**

4. **Component add/remove — PR #25**
   - `unity_add_component`, `unity_remove_component`
   - exact loaded concrete Component type / exact Component identity
   - Transform-family rejection in this bounded mutation contract
   - Undo, native identity/absence verification, replay/stale-replay, cleanup
   - **39/39 EditMode**

5. **Component property edit — PR #26**
   - `unity_set_component_property`
   - exact Component `GlobalObjectId` + exact visible property path
   - first supported value kinds: Boolean, Integer, Float/number, String, Vector3
   - hidden paths, `m_Script`, Transform/RectTransform, unsupported/coerced values rejected
   - live BoxCollider `m_IsTrigger`, `m_Center`, `m_Size` native readback
   - same-id replay, Undo restoration of `m_Size`, stale-replay rejection, cleanup
   - **45/45 EditMode**

6. **Asset search/inspect — PR #27**
   - `unity_search_assets`, `unity_inspect_asset`
   - Unity AssetDatabase as source of truth; no raw recursive filesystem scan
   - bounded/deterministic search under `Assets` or `Packages`
   - exact asset-file inspect with GUID, main type, importer type, labels, dependency hash, direct dependencies
   - scene-state revision is not reused as fake asset concurrency metadata
   - live `Assets/Scenes/SampleScene.unity` GUID/path/hash stability verified
   - `maxDependencies=0` verified; folder inspection rejected as designed
   - **50/50 EditMode**

### Current next candidates

1. prefab inspect/create/apply workflows,
2. script read/write workflows,
3. Play Mode and Test Runner controls,
4. diagnostics extensions where they unlock real workflows,
5. explicit Undo/recovery tools where useful to clients.

No arbitrary C# execution fallback is planned for these capabilities.

## Verification highlights for the latest Phase 3 slices

### Component property edit — PR #26

```text
Environment: Windows + Unity 6000.3.21f1
CI: Node Verification 32625196758 PASS; Phase 1 Local Bridge Verification 32625196748 PASS
EditMode: 45 Passed / 0 Failed
BoxCollider m_IsTrigger: native write/readback + replay PASS
BoxCollider m_Center: Vector3 native write/readback PASS
BoxCollider m_Size: native write/readback + replay PASS
Undo restored prior m_Size; retry after Undo -> stale_target/mutation_replay_stale
Cleanup deleted temporary GameObject
Result: PASS
```

### Asset search/inspect — PR #27

```text
Environment: Windows + Unity 6000.3.21f1
CI: Node Verification 32626184911 PASS; Phase 1 Local Bridge Verification 32626184986 PASS
EditMode: 50 Passed / 0 Failed
Filter: t:Scene
Selected: Assets/Scenes/SampleScene.unity
GUID: 99c9720ab356a0642a771bea13969a05
Main type: UnityEditor.SceneAsset
Importer: UnityEditor.AssetImporter
Dependency hash: 036af77983a498dbf9d9c31b6c19a348
Direct dependencies: 4
Repeated GUID stable=true; repeated hash stable=true
maxDependencies=0 honored=true
Folder inspect -> stale_target/asset_unavailable as designed
Result: PASS
```

## Known limitations / future work

- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized.
- `SessionState` mutation lifecycle does not survive a full Unity Editor restart.
- Clean-scene dirty metadata restoration after Undo rollback is not implemented.
- An already-started Unity API call is not force-cancelled when its deadline later expires.
- Component property edit currently covers only the explicitly supported first-slice value kinds and visible non-Transform properties; enums, object references, arrays/lists, managed references, colors and other complex serialized forms remain future work.
- Component add resolves currently loaded concrete Component types through Unity TypeCache and deliberately rejects Transform/RectTransform in the current contract.
- Asset search/inspection is read-only. Asset/importer mutation, move/rename/delete, source-file text workflows, and prefab mutation remain unimplemented.
- Asset `dependencyHash` is an observation of Unity asset dependency/import state, not a replacement for GUID identity and not yet a complete optimistic-concurrency protocol for future asset writes.
- Current Transform write targets a GameObject `GlobalObjectId` and does not silently reinterpret a Component ID as its owner.
- Recent Console text covers only the current domain-load capture window.
- Unity support beyond 6000.3.21f1 is unverified.
- Multi-editor routing, remote authentication/pairing, remote gateway hosting, and ChatGPT submission/integration remain later-phase work.
