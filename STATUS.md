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
- **Phase 2 — Reliability Core:** Verified milestone, completed 2026-08-23 for the surface that existed at exit.

Phase 2 exit evidence and non-goals are recorded in [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md). Each new Phase 3 write family must adopt and verify the reliability contract independently.

## Current verified environment

- Windows
- Unity **6000.3.21f1**
- Node **24.19.0** in GitHub Actions
- Bridge protocol v0
- Unity package version 0.0.1 during the current verification series

Broader Unity/OS compatibility is not implied.

## Latest real Unity verification

On **2026-08-24**, after the installed-package Test Runner bootstrap/reimport/parser fixes, the package EditMode suite was executed in Unity **6000.3.21f1** and completed:

```text
75 Passed
0 Failed
```

This supersedes the previous 62/62 Prefab Asset creation baseline for the already-verified surface and verifies the installed-package Test Runner discovery flow itself.

The new bounded Prefab property-override apply implementation in **PR #36** was added after that 75/75 run and is therefore **Implemented, not yet Verified**, until the expanded Unity suite is run on the PR/merged revision.

## Current verified / implemented surface

| Area | Status | Evidence / notes |
|---|---|---|
| Unity package + local bridge | Verified | Real compile/load, WebSocket connect/reconnect, main-thread dispatch, stale-route protection, deadlines, and capability preflight exercised on Unity 6000.3.21f1. |
| `editor.status` / `unity_get_status` | Verified | Live Editor/project/scene/play/compile state, Agent capabilities, and scene state token. |
| `scene.hierarchy` / `unity_get_hierarchy` | Verified | Bounded hierarchy with `GlobalObjectId` and truncation metadata. |
| `object.resolve` / `unity_resolve_object` | Verified | Native `GlobalObjectId` re-resolution; missing/Undone targets return `found=false`. |
| `editor.diagnostics` / `unity_get_diagnostics` | Verified | Bounded Console/compiler diagnostics with source-location metadata where Unity supplies it. |
| State revision / stale-state protection | Verified | Session epoch + monotonic revision preconditions reject stale scene writes before mutation. |
| Common mutation transaction | Verified | Main-thread preflight, Undo grouping, semantic verification, rollback, rollback verification, retry identity, and execution-boundary deadline protection for adopted write families. |
| Dirty-state reporting | Verified | Rollback dirty residue is reported explicitly. |
| Dirty-state restoration | Not implemented | Undo-based rollback can leave a previously clean scene dirty. |
| Explicit active-scene save | Verified | Existing saved path only; exact path/state preconditions; native post-save verification; no interactive Save As. |
| Transform read/write | Verified | PR #22; 23/23 EditMode; native readback, Undo, replay and stale-replay protection. |
| GameObject update/delete | Verified | PR #23; 29/29 EditMode; native verification, Undo, replay and stale-replay protection. |
| Component inspect | Verified | PR #24; 33/33 EditMode; native-order Components, Missing Script reporting, bounded visible serialized properties, Component identity/ownership. |
| Component add/remove | Verified | PR #25; 39/39 EditMode; exact Component types/identities, Undo, native verification and replay protection. |
| Component property edit | Verified | PR #26; 45/45 EditMode; visible Boolean/Integer/Float/String/Vector3 serialized-property writes with semantic readback and Undo/replay protection. |
| Asset search/inspect | Verified | PR #27; 50/50 EditMode; bounded `AssetDatabase` search and exact GUID/type/importer/dependency inspection. |
| Prefab inspect/instantiate | Verified | PR #28; 56/56 EditMode; bounded Prefab Asset hierarchy inspect, dependency-hash precondition, linked `PrefabUtility.InstantiatePrefab`, native linkage readback, same-id replay, Undo, stale-replay rejection. |
| Prefab Asset creation | Verified | PR #29; 62/62 milestone; create-only `SaveAsPrefabAsset`, source unchanged, GUID/dependencyHash/root readback, same-id replay, manual asset removal followed by stale-replay rejection. Still covered by the later 75/75 suite. |
| Package Test Runner discovery bootstrap | **Verified** | 2026-08-24 real installed-package run on Unity 6000.3.21f1. Development Local/LocalTarball/Git installs self-add `com.eunsung.unity-ai-bridge` to project `testables`; package reimport handles Test Framework refresh; expanded suite appeared automatically and completed **75/75**. |
| Prefab single-property override apply | **Implemented** | PR #36. New `prefab.property.apply` / `unity_apply_prefab_property_override`: one existing non-array visible serialized-property override, explicit writable Prefab target, scene + dependencyHash preconditions, nested-target correspondence check, persistent-destructive classification, native `DataEquals`/override readback, conservative replay semantics. Expanded real Unity run still required before Verified. |
| Remote gateway / Easy Connect | Planned | Not implemented. |
| Pairing/authentication | Planned | Not implemented. |
| Multi-user/editor routing | Planned | Current local bridge supports one active editor. |
| ChatGPT integration | Planned | Not implemented or submitted. |
| Portable Agent Plugins packaging | Planned | Architecture/roadmap decision recorded; no plugin manifest/skills package implemented yet. |
| Open-weight/local-model compatibility | Deferred target | Architecture note in [`docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md`](docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md). MCP remains the boundary; no model runtime/inference server is being added to the Unity core. |

## Phase 0 — Foundation

✅ **Completed 2026-08-22.**

Repository boundaries, contributor/AI grounding rules, architecture/decisions, provenance rules, Unity target, source scaffold, pinned Node dependencies, protocol v0, initial CI, package compile/load, and Apache-2.0 public-core licensing were established and verified where applicable.

## Phase 1 — Minimal Local End-to-End

✅ **Completed 2026-08-23.**

Verified path:

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

The verified minimum included editor status, hierarchy, empty root GameObject create, mutation replay protection, diagnostics, compiler source-location capture, and domain-reload reconnect/stale-generation rejection.

## Phase 2 — Reliability Core

✅ **Completed 2026-08-23 for the implemented surface at exit.**

Verified slices:

- PR #10 stable resolver / create readback / stale replay
- PR #11 capability metadata/preflight
- PR #12 common transaction + Undo core
- PR #13 forced rollback probe
- PR #14 state revision / stale-state rejection
- PR #15 domain-reload-safe same-session mutation lifecycle
- PR #16 8/8 EditMode reliability tests
- PR #17 structured verification + rollback verification, 12/12
- PR #18 dirty-state reporting, 14/14
- PR #19 explicit scene save, 16/16
- PR #20 execution-boundary deadlines, 19/19

See [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md).

## Phase 3 — Useful Unity Editing Core

Current objective: provide a small but genuinely useful Unity editing/inspection surface without arbitrary code execution while retaining Phase 2 reliability rules.

### Verified slices

1. **Transform read/update — PR #22** — **23/23 EditMode**
2. **GameObject update/delete — PR #23** — **29/29 EditMode**
3. **Component inspection — PR #24** — **33/33 EditMode**
4. **Component add/remove — PR #25** — **39/39 EditMode**
5. **Component property edit — PR #26** — **45/45 EditMode**
6. **Asset search/inspect — PR #27** — **50/50 EditMode**
7. **Prefab inspect/instantiate — PR #28** — **56/56 EditMode**
8. **Prefab Asset creation — PR #29** — **62/62 milestone**
9. **Installed-package Test Runner discovery / regression baseline — PRs #31–#35** — **75/75 EditMode**, verified 2026-08-24

### Implemented after latest verified Unity run

- **Bounded Prefab property override apply — PR #36**
  - `prefab.property.apply` / `unity_apply_prefab_property_override`
  - single existing visible serialized property only
  - no arrays/elements or `m_Script`
  - explicit writable `Assets/*.prefab` target for nested-Prefab correctness
  - exact Prefab dependencyHash + scene state preconditions
  - Model Prefabs rejected in the first slice
  - persistent asset write, no Unity Undo claim
  - semantic verification through fresh source/instance serialized readback and `SerializedProperty.DataEquals`
  - completed same-id replay is readback-only; stale asset/target state fails closed
  - ambiguous execution/verification is not automatically re-executed
  - Unity EditMode integration test and Node bridge tests added, but real Unity execution on this revision is still required

### Package Test Runner discovery verification

```text
Environment: Windows + Unity 6000.3.21f1
Install style: non-embedded development package
Automatic manifest testables registration: PASS
Automatic package reimport/Test Framework discovery: PASS
EunSung.UnityAiBridge.Editor.Tests visible in EditMode Test Runner: PASS
EditMode result: 75 Passed / 0 Failed
Result: PASS
Date: 2026-08-24
```

### Current next candidates

1. run the expanded Unity EditMode suite for PR #36 and verify the bounded Prefab property apply integration test,
2. script read/write workflows,
3. Play Mode and Test Runner controls,
4. diagnostics extensions where they unlock real workflows,
5. explicit Undo/recovery tools where useful to clients,
6. only then consider broader Prefab apply/revert slices such as object/component-wide apply, Apply All, Revert, variants, or unpacking when bounded contracts are clear.

No arbitrary C# execution fallback is planned.

## Known limitations / future work

- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized.
- `SessionState` mutation lifecycle does not survive a full Unity Editor restart.
- Clean-scene dirty metadata restoration after Undo rollback is not implemented.
- An already-started Unity API call is not force-cancelled when its deadline later expires.
- Component property edit supports only the explicitly bounded first-slice value kinds; complex serialized forms remain future work.
- Component add deliberately rejects Transform/RectTransform in the current contract.
- Asset search/inspection remains read-only; generic importer mutation and generic asset move/rename/delete are not implemented.
- Prefab Asset creation is create-only under `Assets`, never overwrites an existing asset, and is a persistent disk write without Unity Undo.
- Prefab property apply currently covers exactly one existing visible non-array override, requires an explicit writable Prefab Asset target, rejects Model Prefabs, and does not claim generic automatic rollback after an ambiguous persistent asset mutation.
- Prefab Apply All, object/component-wide Apply, Revert Overrides, unpacking, variant authoring, and generic asset deletion remain unimplemented.
- Asset `dependencyHash` is an imported-state observation used as the current Prefab asset precondition; it is not a replacement for GUID identity or a general asset transaction token.
- Recent Console text covers only the current domain-load capture window.
- Unity support beyond 6000.3.21f1 is unverified.
- Multi-editor routing, remote authentication/pairing, remote gateway hosting, and production AI-host integrations remain later-phase work.
- Open-weight/local models remain a later compatibility target through MCP-capable agent runtimes; the Unity core does not own model serving.
