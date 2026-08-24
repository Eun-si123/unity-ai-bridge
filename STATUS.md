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

On **2026-08-24**, the installed-package EditMode suite was executed on main revision:

```text
7787c4b5317e628924f22cedd576964cce20103d
```

Environment/result:

```text
Windows
Unity 6000.3.21f1
80 Passed
0 Failed
```

This supersedes the previous 75/75 package-Test-Runner baseline for the full currently implemented Unity EditMode surface. It verifies the bounded Prefab single-property override apply integration path in real Unity in addition to preserving the previously verified slices.

The dedicated live MCP stdio -> bridge -> Unity verifier added by PR #42 remains a separate end-to-end gate until it is run against a live Editor; source presence or GitHub Actions alone must not be treated as proof of that live path.

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
| Transform read/write | Verified | PR #22; 23/23 milestone and still covered by the later 80/80 EditMode run; native readback, Undo, replay and stale-replay protection. |
| GameObject update/delete | Verified | PR #23; 29/29 milestone and later regression coverage; native verification, Undo, replay and stale-replay protection. |
| Component inspect | Verified | PR #24; 33/33 milestone and later regression coverage; native-order Components, Missing Script reporting, bounded visible serialized properties, Component identity/ownership. |
| Component add/remove | Verified | PR #25; 39/39 milestone and later regression coverage; exact Component types/identities, Undo, native verification and replay protection. |
| Component property edit | Verified | PR #26; 45/45 milestone and later regression coverage; visible Boolean/Integer/Float/String/Vector3 serialized-property writes with semantic readback and Undo/replay protection. |
| Asset search/inspect | Verified | PR #27; 50/50 milestone and later regression coverage; bounded `AssetDatabase` search and exact GUID/type/importer/dependency inspection. |
| Prefab inspect/instantiate | Verified | PR #28; 56/56 milestone and later regression coverage; bounded Prefab Asset hierarchy inspect, dependency-hash precondition, linked `PrefabUtility.InstantiatePrefab`, native linkage readback, same-id replay, Undo, stale-replay rejection. |
| Prefab Asset creation | Verified | PR #29; 62/62 milestone and still covered by the 80/80 suite; create-only `SaveAsPrefabAsset`, source unchanged, GUID/dependencyHash/root readback, same-id replay, manual asset removal followed by stale-replay rejection. |
| Package Test Runner discovery bootstrap | **Verified** | 2026-08-24 real installed-package runs on Unity 6000.3.21f1. Development Local/LocalTarball/Git installs self-add `com.eunsung.unity-ai-bridge` to project `testables`; guarded package reimport handles Test Framework refresh. Initial discovery run completed 75/75; latest expanded suite completed **80/80**. |
| Prefab single-property override apply | **Verified** | PR #36 plus test-harness hardening through PR #40; real Unity 6000.3.21f1 expanded suite completed **80/80** on revision `7787c4b...`. Covers one existing non-array visible serialized-property override, explicit writable Prefab target, scene + dependencyHash preconditions, nested-target correspondence, persistent-destructive classification, native `DataEquals`/override readback, same-id replay and stale-replay rejection. Dedicated live MCP E2E remains a separate pending gate. |
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

1. **Transform read/update — PR #22** — **23/23 EditMode** milestone
2. **GameObject update/delete — PR #23** — **29/29 EditMode** milestone
3. **Component inspection — PR #24** — **33/33 EditMode** milestone
4. **Component add/remove — PR #25** — **39/39 EditMode** milestone
5. **Component property edit — PR #26** — **45/45 EditMode** milestone
6. **Asset search/inspect — PR #27** — **50/50 EditMode** milestone
7. **Prefab inspect/instantiate — PR #28** — **56/56 EditMode** milestone
8. **Prefab Asset creation — PR #29** — **62/62 EditMode** milestone
9. **Installed-package Test Runner discovery / regression baseline — PRs #31–#35** — **75/75 EditMode**, verified 2026-08-24
10. **Bounded Prefab property override apply — PR #36 + harness fixes #37–#40** — **80/80 EditMode**, verified 2026-08-24 on revision `7787c4b5317e628924f22cedd576964cce20103d`

### Bounded Prefab property override apply contract

- `prefab.property.apply` / `unity_apply_prefab_property_override`
- single existing visible serialized property only
- no arrays/elements or `m_Script`
- explicit writable `Assets/*.prefab` target for nested-Prefab correctness
- exact Prefab dependencyHash + scene state preconditions
- Model Prefabs rejected in the first slice
- persistent asset write, no generic Unity Undo claim
- semantic verification through fresh source/instance serialized readback and `SerializedProperty.DataEquals`
- completed same-id replay is readback-only; stale asset/target state fails closed
- ambiguous execution/verification is not automatically re-executed
- real Unity EditMode integration test passes in the 80/80 suite
- PR #42 adds a separate live MCP end-to-end verifier; that verifier is not marked PASS until a real Editor run succeeds

### Package Test Runner discovery verification

```text
Environment: Windows + Unity 6000.3.21f1
Install style: non-embedded development package
Automatic manifest testables registration: PASS
Automatic package reimport/Test Framework discovery: PASS
EunSung.UnityAiBridge.Editor.Tests visible in EditMode Test Runner: PASS
Latest EditMode result: 80 Passed / 0 Failed
Revision: 7787c4b5317e628924f22cedd576964cce20103d
Result: PASS
Date: 2026-08-24
```

### Current next candidates

1. run the dedicated live MCP `verify:prefab-property-apply` gate added by PR #42,
2. resolve/audit **#41** so direct `Undo.RecordObject` writes on Prefab instances have explicit correct override-recording semantics,
3. script read/write workflows,
4. Play Mode and Test Runner controls,
5. diagnostics extensions where they unlock real workflows,
6. explicit Undo/recovery tools where useful to clients,
7. only then consider broader Prefab apply/revert slices such as object/component-wide apply, Apply All, Revert, variants, or unpacking when bounded contracts are clear.

No arbitrary C# execution fallback is planned.

## Known limitations / future work

- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized; live verifiers that require durable scene-object IDs should use a saved active Scene.
- `SessionState` mutation lifecycle does not survive a full Unity Editor restart.
- Clean-scene dirty metadata restoration after Undo rollback is not implemented.
- An already-started Unity API call is not force-cancelled when its deadline later expires.
- Component property edit supports only the explicitly bounded first-slice value kinds; complex serialized forms remain future work.
- Component add deliberately rejects Transform/RectTransform in the current contract.
- Asset search/inspection remains read-only; generic importer mutation and generic asset move/rename/delete are not implemented.
- Prefab Asset creation is create-only under `Assets`, never overwrites an existing asset, and is a persistent disk write without Unity Undo.
- Prefab property apply currently covers exactly one existing visible non-array override, requires an explicit writable Prefab Asset target, rejects Model Prefabs, and does not claim generic automatic rollback after an ambiguous persistent asset mutation.
- Direct Prefab-instance writes performed through `Undo.RecordObject` are under explicit follow-up audit in **#41** for `PrefabUtility.RecordPrefabInstancePropertyModifications` semantics; `SerializedObject`/`SerializedProperty` Component-property writes are not blocked by that audit.
- Prefab Apply All, object/component-wide Apply, Revert Overrides, unpacking, variant authoring, and generic asset deletion remain unimplemented.
- Asset `dependencyHash` is an imported-state observation used as the current Prefab asset precondition; it is not a replacement for GUID identity or a general asset transaction token.
- Recent Console text covers only the current domain-load capture window.
- Unity support beyond 6000.3.21f1 is unverified.
- Multi-editor routing, remote authentication/pairing, remote gateway hosting, and production AI-host integrations remain later-phase work.
- Open-weight/local models remain a later compatibility target through MCP-capable agent runtimes; the Unity core does not own model serving.
