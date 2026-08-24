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

On **2026-08-24**, the expanded installed-package EditMode suite for **PR #45** completed:

```text
Windows
Unity 6000.3.21f1
89 Passed
0 Failed
```

This supersedes the 85/85 PR #44 baseline for the installed-package EditMode suite. The new four tests cover the bounded Script-replace validation/intent/atomic-write helper surface without intentionally triggering a domain reload inside Test Runner.

The dedicated live MCP `verify:script-replace` gate was then attempted. The first attempt reached a real script compilation/domain-reload boundary but the verifier process hit the MCP TypeScript SDK's default 60-second request timeout before the long-running tool returned. Immediate guarded recovery also ran before Unity had reconnected, so it could not inspect the target. The verifier saved an exact local recovery copy instead of blindly overwriting the script.

That verifier defect is fixed on PR #45 head `1b12d498413c82c3eb80a886a451d8c3d089b251` by:

- setting explicit 180-second MCP `callTool` request budgets for long Script-replace operations;
- waiting for Unity Script capabilities to return before guarded recovery;
- precomputing the intended modified raw SHA so recovery can reconcile even if the write response itself is lost;
- writing a recovery copy before mutation and removing it only after exact restoration;
- preserving the rule that any third/unrecognized SHA is never automatically overwritten.

Latest automated CI for that verifier-fix head:

```text
Node Verification: PASS
Phase 1 Local Bridge Verification: PASS
```

The live Script-replace gate must be rerun successfully before `script.replace` can become Verified or PR #45 can merge.

Historical verified Script-read evidence from PR #44 remains valid: Unity 6000.3.21f1 completed **85/85**, and the dedicated `verify:script-read` MCP gate reconstructed `Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs` exactly with stable GUID/SHA/dependency identity and no project mutation.

Separately, the dedicated PR #42 live MCP `verify:prefab-property-apply` gate passed on 2026-08-24 against Unity 6000.3.21f1. It verified changed Prefab dependency hash, independent fresh-instance readback, read-only same-`mutationId` replay, asset-removal observation, stale replay rejection, and scene-object cleanup.

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
| Transform read/write | Verified | PR #22 baseline plus later regression coverage. PR #43 verifies direct scene-Prefab Transform writes record real Prefab overrides. |
| GameObject update/delete | Verified | PR #23 baseline plus later regression coverage. PR #43 verifies direct scene-Prefab name/active writes record real Prefab overrides. |
| Component inspect | Verified | PR #24; native-order Components, Missing Script reporting, bounded visible serialized properties, Component identity/ownership. |
| Component add/remove | Verified | PR #25; exact Component types/identities, Undo, native verification and replay protection. |
| Component property edit | Verified | PR #26; visible Boolean/Integer/Float/String/Vector3 serialized-property writes with semantic readback and Undo/replay protection. |
| Asset search/inspect | Verified | PR #27; bounded `AssetDatabase` search and exact GUID/type/importer/dependency inspection. |
| Script read | **Verified** | PR #44; exact `.cs` Unity assets under Assets/Packages, canonical GUID/path + MonoScript validation, strict UTF-8/BOM handling, raw SHA-256, dependencyHash, bounded paging and 4 MiB source cap. Real Unity 85/85 plus live MCP PASS. |
| Script replace/write | **Implemented** | PR #45. Existing `Assets/*.cs` only; path+GUID+raw-SHA CAS, strict UTF-8/BOM preservation, editability preflight, atomic persistence, exact SHA readback, at-most-once SessionState reconciliation across compile/domain reload, compiler outcome separated from persistence, and fresh post-reload Script readback. Real Unity **89/89** passed; dedicated live MCP gate must be rerun after verifier timeout hardening before this can be Verified. |
| Prefab inspect/instantiate | Verified | PR #28; bounded Prefab Asset hierarchy inspect, dependency-hash precondition, linked `PrefabUtility.InstantiatePrefab`, native linkage readback, same-id replay, Undo, stale-replay rejection. |
| Prefab Asset creation | Verified | PR #29; create-only `SaveAsPrefabAsset`, source unchanged, GUID/dependencyHash/root readback, same-id replay, manual asset removal followed by stale-replay rejection. |
| Package Test Runner discovery bootstrap | **Verified** | Development Local/LocalTarball/Git installs self-add `com.eunsung.unity-ai-bridge` to project `testables`; guarded package reimport handles Test Framework refresh. Latest expanded suite completed **89/89** on PR #45. |
| Prefab single-property override apply | **Verified** | PR #36 + harness hardening #37–#40; 80/80 real Unity integration and dedicated PR #42 live MCP E2E PASS. |
| Direct `Undo.RecordObject` Prefab-instance writes | **Verified** | #41 / PR #43. `PrefabUtility.RecordPrefabInstancePropertyModifications` is guarded to non-asset scene Prefab instances. Real integration verifies `m_LocalScale` and `m_IsActive` overrides persist after scene save; historical milestone 81/81. |
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

Phase 2 established the reliability vocabulary and common transaction model used by later mutation families. Historical detailed evidence remains in `docs/PHASE2_EXIT_GATE.md` and repository history.

## Phase 3 — Useful Unity Editing Core

🚧 **In progress.**

Current verified families include Transform, GameObject, Component, Asset, Prefab, Script read, diagnostics/save/resolver, and direct Prefab-instance override semantics. Script replace is implemented and has passed the expanded 89/89 EditMode gate, but its dedicated real compile/domain-reload MCP gate remains pending after verifier timeout hardening.

## Verification rule

A feature is **Verified** only after its relevant real-runtime gate passes on a named environment/revision. CI-only or source-only implementation is never promoted to Verified.