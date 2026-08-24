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

On **2026-08-24**, the expanded installed-package EditMode suite for **PR #43** completed:

```text
Windows
Unity 6000.3.21f1
81 Passed
0 Failed
```

The tested PR head was `dfa183ce46056f45613c152516df6cdcebd29a02`; PR #43 was then squash-merged to main as `f9e5c9b1561175629b3ba15ae27502c253dec889`.

This supersedes the earlier 80/80 regression baseline and verifies the direct scene-Prefab override-recording fix for Transform and GameObject direct `Undo.RecordObject` writes in addition to all previously covered slices. Issue #41 is closed as completed.

Separately, the dedicated PR #42 live MCP `verify:prefab-property-apply` gate was executed on 2026-08-24 against Unity 6000.3.21f1 and passed. It verified changed Prefab dependency hash, independent fresh-instance readback, read-only same-`mutationId` replay, manual asset-removal observation, `stale_target/mutation_replay_stale` after the Prefab disappeared, and temporary scene-object cleanup.

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
| Transform read/write | Verified | PR #22 baseline plus later regression coverage. PR #43 verifies direct scene-Prefab Transform writes record real Prefab overrides; latest real suite 81/81. |
| GameObject update/delete | Verified | PR #23 baseline plus later regression coverage. PR #43 verifies direct scene-Prefab name/active writes record real Prefab overrides; latest real suite 81/81. |
| Component inspect | Verified | PR #24; native-order Components, Missing Script reporting, bounded visible serialized properties, Component identity/ownership. |
| Component add/remove | Verified | PR #25; exact Component types/identities, Undo, native verification and replay protection. |
| Component property edit | Verified | PR #26; visible Boolean/Integer/Float/String/Vector3 serialized-property writes with semantic readback and Undo/replay protection. |
| Asset search/inspect | Verified | PR #27; bounded `AssetDatabase` search and exact GUID/type/importer/dependency inspection. |
| Script read | **Implemented** | PR #44 candidate: `script.read` / `unity_read_script`; exact `.cs` Unity assets under Assets/Packages, canonical GUID/path + MonoScript validation, package resolution through Package Manager, strict UTF-8/BOM handling, raw SHA-256, dependencyHash, bounded paging and 4 MiB source-size cap. Node/local-bridge CI is passing; expanded real Unity + live MCP verification still required. |
| Prefab inspect/instantiate | Verified | PR #28; bounded Prefab Asset hierarchy inspect, dependency-hash precondition, linked `PrefabUtility.InstantiatePrefab`, native linkage readback, same-id replay, Undo, stale-replay rejection. |
| Prefab Asset creation | Verified | PR #29; create-only `SaveAsPrefabAsset`, source unchanged, GUID/dependencyHash/root readback, same-id replay, manual asset removal followed by stale-replay rejection. |
| Package Test Runner discovery bootstrap | **Verified** | Development Local/LocalTarball/Git installs self-add `com.eunsung.unity-ai-bridge` to project `testables`; guarded package reimport handles Test Framework refresh. Latest expanded suite completed **81/81**. |
| Prefab single-property override apply | **Verified** | PR #36 + harness hardening #37–#40; 80/80 real Unity integration and dedicated PR #42 live MCP E2E PASS. |
| Direct `Undo.RecordObject` Prefab-instance writes | **Verified** | #41 / PR #43. `PrefabUtility.RecordPrefabInstancePropertyModifications` is guarded to non-asset scene Prefab instances. Real integration verifies `m_LocalScale` and `m_IsActive` overrides persist after scene save; **81/81**. |
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
9. **Installed-package Test Runner discovery — PRs #31–#35** — **75/75**, verified 2026-08-24
10. **Bounded Prefab property override apply — PR #36 + #37–#40** — **80/80**, plus PR #42 live MCP E2E PASS
11. **Direct scene-Prefab override recording — #41 / PR #43** — **81/81**, verified 2026-08-24

### Implemented after latest verified Unity run

- **Bounded Script read — PR #44 candidate**
  - `script.read` / `unity_read_script`
  - exact project-relative `.cs` Unity asset path only
  - reads Assets and resolved Packages; no writes
  - verifies the path through GUID + `MonoScript`
  - strict UTF-8 decode with optional BOM reporting
  - raw source-file SHA-256 for the future write CAS precondition
  - Unity dependencyHash returned as imported-state metadata
  - offset paging in UTF-16 code units with surrogate-pair boundary protection
  - maximum 100,000 returned UTF-16 code units per call
  - maximum 4 MiB source file to keep memory bounded
  - Node bridge tests + real Unity EditMode tests + live MCP verifier added
  - latest GitHub Node Verification and Phase 1 Local Bridge Verification pass after the payload-narrowing fix
  - real Unity execution on this PR revision is still required before Verified

### Script write direction

The next Script write family is deliberately not implemented yet. `.cs` mutation can trigger Unity AssetDatabase import, script compilation, assembly reload, and domain reload, so the first write contract must be reload-aware rather than reusing a scene-mutation pattern blindly.

Proposed first write contract:

```text
script.read observation
 -> exact Assets/*.cs path
 -> expected contentSha256 CAS precondition
 -> mutationId / durable lifecycle intent
 -> bounded UTF-8 replacement write
 -> AssetDatabase import / compilation observation
 -> reconnect/domain-reload reconciliation
 -> native re-read + new SHA verification
 -> diagnostics/compile outcome
```

Package scripts remain read-only in the planned first write slice. Blind overwrite without a current content hash is not planned.

### Current next candidates

1. run PR #44 expanded Unity EditMode suite: previous 81 + 4 Script-read tests = expected **85 tests**,
2. run `npm --prefix mcp-server run verify:script-read` against the same candidate package,
3. after both pass, mark Script read Verified and merge PR #44,
4. design/implement the reload-safe `script.replace` CAS workflow,
5. Play Mode and Test Runner controls,
6. diagnostics extensions where they unlock real workflows,
7. explicit Undo/recovery tools where useful to clients,
8. only then consider broader Prefab apply/revert slices when bounded contracts are clear.

No arbitrary C# execution fallback is planned.

## Known limitations / future work

- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized; live verifiers that require durable scene-object IDs should use a saved active Scene.
- `SessionState` mutation lifecycle does not survive a full Unity Editor restart.
- Clean-scene dirty metadata restoration after Undo rollback is not implemented.
- An already-started Unity API call is not force-cancelled when its deadline later expires.
- Component property edit supports only the explicitly bounded first-slice value kinds; complex serialized forms remain future work.
- Component add deliberately rejects Transform/RectTransform in the current contract.
- Generic importer mutation and generic asset move/rename/delete are not implemented.
- Script read currently supports strict UTF-8 source only, exact `.cs` Unity assets, at most 4 MiB per source file, and character paging rather than line/symbol parsing.
- Script write/replace is not implemented yet; compilation/domain-reload-safe mutation semantics remain the next Script reliability problem.
- Prefab Asset creation is create-only under `Assets`, never overwrites an existing asset, and is a persistent disk write without Unity Undo.
- Prefab property apply covers exactly one existing visible non-array override, requires an explicit writable Prefab Asset target, rejects Model Prefabs, and does not claim generic automatic rollback after an ambiguous persistent asset mutation.
- Prefab Apply All, object/component-wide Apply, Revert Overrides, unpacking, variant authoring, and generic asset deletion remain unimplemented.
- Asset `dependencyHash` is imported-state metadata/precondition evidence for the current bounded asset contracts; it is not a general transaction token. Script write plans use raw content SHA-256 as the file-content CAS token instead.
- Recent Console text covers only the current domain-load capture window.
- Unity support beyond 6000.3.21f1 is unverified.
- Multi-editor routing, remote authentication/pairing, remote gateway hosting, and production AI-host integrations remain later-phase work.
- Open-weight/local models remain a later compatibility target through MCP-capable agent runtimes; the Unity core does not own model serving.
