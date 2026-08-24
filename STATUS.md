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
| Prefab Asset creation | Verified | PR #29; 62/62 EditMode; create-only `SaveAsPrefabAsset`, source unchanged, GUID/dependencyHash/root readback, same-id replay, manual asset removal followed by stale-replay rejection. |
| Package Test Runner discovery bootstrap | Implemented | Test assembly already exists. New Editor bootstrap adds `com.eunsung.unity-ai-bridge` to project `testables` for Local/LocalTarball/Git installs, leaves Embedded/Registry untouched, and has manifest-transform EditMode tests. Fresh non-embedded Unity install verification is still required before marking Verified. |
| Remote gateway / Easy Connect | Planned | Not implemented. |
| Pairing/authentication | Planned | Not implemented. |
| Multi-user/editor routing | Planned | Current local bridge supports one active editor. |
| ChatGPT integration | Planned | Not implemented or submitted. |
| Portable Agent Plugins packaging | Planned | Architecture/roadmap decision recorded; no plugin manifest/skills package implemented yet. |

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
8. **Prefab Asset creation — PR #29** — **62/62 EditMode**

### Implemented after latest verified Unity run

- **Package Test Runner discovery bootstrap** — development-style non-embedded installs can self-add the package to the project manifest `testables` array; automatic behavior is intentionally not claimed Verified until reproduced in a fresh Unity project.
- Manifest transformation tests cover adding a missing `testables`, appending without deleting existing package names, idempotent no-op, malformed-value rejection, and package-source gating.

### Prefab Asset creation verification — PR #29

```text
Environment: Windows + Unity 6000.3.21f1
EditMode: 62 Passed / 0 Failed
Destination: Assets/UnityAiBridge_Prefab_Create_Verify_1787477543534_2a6032058e974734b6d7eda5b7cb5512.prefab
Created GUID: 9620866f03a86444897f7edef5652f8a
Observed dependencyHash: 54acfe634f8153a9f4f5b8c06cb4d17b
Source scene GameObject unchanged: PASS
Native Prefab Asset inspect/readback: PASS
Immediate same-id replay: PASS
Manual Project-window asset removal observed: PASS
Retry after removal -> stale_target/mutation_replay_stale: PASS
Temporary source GameObject removed: PASS
Result: PASS
```

Real verification also caught two useful contract/verifier issues: fixed destinations could collide with a prior local test artifact, so the verifier now uses a unique path; and Prefab root verification no longer assumes the saved root name must equal the source scene GameObject name when Unity derives the asset root from a different destination filename.

### Current next candidates

1. verify package Test Runner auto-discovery in a fresh Local or Git package install,
2. bounded Prefab Apply Overrides workflow,
3. script read/write workflows,
4. Play Mode and Test Runner controls,
5. diagnostics extensions where they unlock real workflows,
6. explicit Undo/recovery tools where useful to clients.

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
- Prefab Apply/Revert Overrides, unpacking, variant authoring, and generic asset deletion are not yet implemented.
- Asset `dependencyHash` is an imported-state observation used as the current Prefab asset precondition; it is not a replacement for GUID identity or a general asset transaction token.
- Recent Console text covers only the current domain-load capture window.
- Unity support beyond 6000.3.21f1 is unverified.
- Package Test Runner auto-discovery has source-level/unit-test coverage but still needs fresh installed-package runtime verification.
- Multi-editor routing, remote authentication/pairing, remote gateway hosting, and production AI-host integrations remain later-phase work.
