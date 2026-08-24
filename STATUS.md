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

This supersedes the 85/85 Script-read baseline while preserving the earlier milestones below.

The dedicated live MCP `verify:script-replace` gate also passed on Unity 6000.3.21f1 after verifier timeout hardening. Observed evidence:

```text
scriptPath: Assets/UnityAiBridge_ScriptReplaceVerify.cs
guid: 858b3c89136ccfd49bc534aefa7ef77f
originalContentSha256: 7c224abcea8bc199f94ac1f15d28e3a881ae67e67c8da28585fc9137d48af676
modifiedContentSha256: ae4761b741782fe4b40a2cfa03c7f3eb7dfc480ebf4cd682ec0891c5554dd9bb
writeCompileStatus: succeeded
writeCompilationSequence: 4
writeReloadObserved: true
sameIdReplayReadOnly: true
staleOldShaRejected: true
staleAttemptLeftModifiedBytesUnchanged: true
restoreCompileStatus: succeeded
restoreReloadObserved: true
exactOriginalRestored: true
finalContentSha256: 7c224abcea8bc199f94ac1f15d28e3a881ae67e67c8da28585fc9137d48af676
recoveryCopyRemovedAfterSuccess: true
```

The first live run on a slower machine exposed a verifier-layer timeout mismatch: the MCP SDK's default 60-second request timeout could expire while Unity legitimately performed import, compilation, domain reload, and reconnect. The verifier was hardened to use explicit longer tool-call timeouts, wait for Script capabilities before guarded recovery, precompute the intended modified SHA, and preserve an exact pre-mutation recovery copy until exact restoration succeeds. This was a verifier/orchestration issue, not evidence of a failed Unity write contract.

The dedicated live MCP `verify:script-read` gate previously passed on the same Unity version. Observed evidence:

```text
scriptPath: Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs
guid: 535573b5098b07445b02ce5ea969259d
sourceKind: Packages
packageName: com.eunsung.unity-ai-bridge
dependencyHash: 1b006f5ec0facfe79226658b89960cda
contentSha256: b52e965c2c01290b03ba70ca1ca60f6eb62870b4665a821632e5993d7d776fc7
encoding: utf-8
hasUtf8Bom: false
byteLength: 206
utf16CharCount: 206
lineCount: 9
chunkSize: 64
chunkCount: 4
reconstructedExactly: true
chunkIdentityStable: true
immediateRepeatStable: true
projectMutated: false
```

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
| Script read | **Verified** | PR #44; `script.read` / `unity_read_script`; exact `.cs` Unity assets under Assets/Packages, canonical GUID/path + MonoScript validation, Package Manager resolution, strict UTF-8/BOM handling, raw SHA-256, dependencyHash, bounded paging and 4 MiB source-size cap. Real Unity **85/85** plus live MCP reconstruction/identity/non-mutation gate PASS. |
| Script replace/write | **Verified** | PR #45 candidate; `script.replace` / `unity_replace_script`; existing `Assets/*.cs` only, mandatory path + GUID + raw SHA-256 CAS, bounded complete-source replacement, editability checks, prepared/written journal, atomic replacement, compile outcome separation, reload/reconnect reconciliation, same-id read-only replay, stale-content rejection, post-reload readback, guarded recovery. Real Unity **89/89** plus live MCP CAS/write/reload/replay/stale/restore gate PASS. |
| Prefab inspect/instantiate | Verified | PR #28; bounded Prefab Asset hierarchy inspect, dependency-hash precondition, linked `PrefabUtility.InstantiatePrefab`, native linkage readback, same-id replay, Undo, stale-replay rejection. |
| Prefab Asset creation | Verified | PR #29; create-only `SaveAsPrefabAsset`, source unchanged, GUID/dependencyHash/root readback, same-id replay, manual asset removal followed by stale-replay rejection. |
| Package Test Runner discovery bootstrap | **Verified** | Development Local/LocalTarball/Git installs self-add `com.eunsung.unity-ai-bridge` to project `testables`; guarded package reimport handles Test Framework refresh. Latest expanded suite completed **89/89**. |
| Prefab single-property override apply | **Verified** | PR #36 + harness hardening #37–#40; 80/80 real Unity integration and dedicated PR #42 live MCP E2E PASS. |
| Direct `Undo.RecordObject` Prefab-instance writes | **Verified** | #41 / PR #43. `PrefabUtility.RecordPrefabInstancePropertyModifications` is guarded to non-asset scene Prefab instances. Real integration verifies `m_LocalScale` and `m_IsActive` overrides persist after scene save; historical milestone **81/81**. |
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

1. **Transform read/update — PR #22** — **23/23** milestone
2. **GameObject update/delete — PR #23** — **29/29** milestone
3. **Component inspection — PR #24** — **33/33** milestone
4. **Component add/remove — PR #25** — **39/39** milestone
5. **Component property edit — PR #26** — **45/45** milestone
6. **Asset search/inspect — PR #27** — **50/50** milestone
7. **Prefab inspect/instantiate — PR #28** — **56/56** milestone
8. **Prefab Asset creation — PR #29** — **62/62** milestone
9. **Installed-package Test Runner discovery — PRs #31–#35** — **75/75**, verified 2026-08-24
10. **Bounded Prefab property override apply — PR #36 + #37–#40** — **80/80**, plus PR #42 live MCP E2E PASS
11. **Direct scene-Prefab override recording — #41 / PR #43** — **81/81**, verified 2026-08-24
12. **Bounded Script read — PR #44** — **85/85** plus live MCP `verify:script-read` PASS, verified 2026-08-24
13. **Reload-safe Script replace — PR #45** — **89/89** plus live MCP `verify:script-replace` CAS/write/compile/reload/replay/stale/restore PASS, verified 2026-08-24

### Verified Script read contract

- `script.read` / `unity_read_script`
- exact project-relative `.cs` Unity asset paths only
- reads both `Assets/` and resolved `Packages/`; no writes
- canonical GUID/path and `MonoScript` validation
- strict UTF-8 decode with optional BOM reporting
- raw source-file SHA-256 for content CAS
- Unity dependencyHash as imported-state metadata
- UTF-16 offset paging with surrogate-pair boundary protection
- maximum 100,000 returned UTF-16 code units per call
- maximum 4 MiB source file
- raw bridge paging fields range-checked before `int` conversion
- live multi-chunk reconstruction verifies stable identity/hash metadata and no project mutation

### Verified Script replace contract

`script.replace` / `unity_replace_script` is the first bounded persistent Script mutation family.

```text
script.read observation
 -> exact writable Assets/*.cs path
 -> expected GUID + raw contentSha256 CAS
 -> validate replacement content/encoding/bounds/editability
 -> record mutationId journal before persistence
 -> compare current bytes to expected identity/SHA
 -> atomic replacement + exact new SHA verification
 -> AssetDatabase import / compilation observation
 -> tolerate expected domain reload/reconnect
 -> same-id reconciliation without a blind second write
 -> post-reload script.read GUID/SHA verification
 -> report persistence and compiler outcome separately
```

Verified first-slice constraints and behavior:

- Package scripts remain read-only.
- Complete replacement content is bounded; no arbitrary patch interpreter is exposed.
- Blind overwrite without the current GUID + `contentSha256` is rejected.
- Stale content fails before persistence.
- The same mutationId never blindly repeats an already-started source write.
- Compiler failure is an observable post-persistence outcome, not proof that persistence failed.
- Source-file persistence is not Unity Undo.
- Recovery is guarded by recognized exact SHA states and refuses an unknown third SHA.
- Slow-machine/large-project compile+reload time is allowed by explicit long external tool-call timeouts; reconnect is treated as a normal success-path boundary rather than a transport failure.

### Current next candidates

1. Play Mode and Test Runner controls,
2. diagnostics extensions where they unlock real workflows,
3. explicit Undo/recovery tools where useful to clients,
4. broader tool-schema compatibility tests as the surface grows,
5. only then consider broader Prefab apply/revert slices when bounded contracts are clear.

No arbitrary C# execution fallback is planned.

## Known limitations / future work

- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized; live verifiers that require durable scene-object IDs should use a saved active Scene.
- `SessionState` mutation lifecycle does not survive a full Unity Editor restart.
- Clean-scene dirty metadata restoration after Undo rollback is not implemented.
- An already-started Unity API call is not force-cancelled when its deadline later expires.
- Component property edit supports only the explicitly bounded first-slice value kinds; complex serialized forms remain future work.
- Component add deliberately rejects Transform/RectTransform in the current contract.
- Generic importer mutation and generic asset move/rename/delete are not implemented.
- Script read supports strict UTF-8 source only, exact `.cs` Unity assets, at most 4 MiB per source file, and character paging rather than line/symbol parsing.
- Script replace supports only existing editable `Assets/*.cs`, complete bounded replacement content, raw GUID/SHA CAS, and current-session reload reconciliation; Packages are read-only and there is no generic source Undo/rollback claim.
- Script-replace live verification demonstrated that fixed short client timeouts can false-fail on slower machines during legitimate compile/domain reload. Callers that synchronously wait for the terminal result need enough timeout headroom for project/machine variability, while same-id reconciliation remains the safety mechanism for ambiguous transport outcomes.
- Prefab Asset creation is create-only under `Assets`, never overwrites an existing asset, and is a persistent disk write without Unity Undo.
- Prefab property apply covers exactly one existing visible non-array override, requires an explicit writable Prefab Asset target, rejects Model Prefabs, and does not claim generic automatic rollback after an ambiguous persistent asset mutation.
- Prefab Apply All, object/component-wide Apply, Revert Overrides, unpacking, variant authoring, and generic asset deletion remain unimplemented.
- Asset `dependencyHash` is imported-state metadata/precondition evidence for the current bounded asset contracts; it is not a general transaction token. Script writes use raw content SHA-256 as the file-content CAS token.
- Recent Console text covers only the current domain-load capture window.
- Unity support beyond 6000.3.21f1 is unverified.
- Multi-editor routing, remote authentication/pairing, remote gateway hosting, and production AI-host integrations remain later-phase work.
- Open-weight/local models remain a later compatibility target through MCP-capable agent runtimes; the Unity core does not own model serving.