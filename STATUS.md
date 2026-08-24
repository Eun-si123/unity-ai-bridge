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

On **2026-08-24**, PR #48 product head `00fc44fb0b9e4fac855c5853d2aeb3fe1d7d125c` completed the expanded installed-package EditMode suite:

```text
Windows
Unity 6000.3.21f1
100 Passed
0 Failed
```

The dedicated runtime-capable PlayMode verifier assembly also completed:

```text
EunSung.UnityAiBridge.PlayMode.Tests
1 Passed
0 Failed
```

The dedicated live MCP `verify:playmode-tests` gate passed on Unity 6000.3.21f1. Observed evidence:

```text
assemblyName: EunSung.UnityAiBridge.PlayMode.Tests
exactTestName: UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode
runGuid: 463bc221-4385-4b94-87a4-78313e9dc60d
initialStatus: scheduled
initialDeliveryReconciled: false
immediateReplayReadOnly: true
terminalStatus: completed
resultState: Passed
selectedTestCaseCount: 1
passCount: 1
failCount: 0
skipCount: 0
inconclusiveCount: 0
issueCount: 0
issuesTruncated: false
completedReplayReadOnly: true
runGuidStableAcrossReplays: true
conflictingSameIdSelectionRejected: true
finalPlayModeState: edit
enterPlayModeOptionsEnabled: false
disableDomainReload: false
disableSceneReload: false
userEnterPlayModeSettingsPreserved: true
exactFinalEditStateRestored: true
verifierTestProvedApplicationIsPlayingAcrossFrame: true
```

`initialDeliveryReconciled=false` is a normal observed fast-path outcome: this run returned its initial scheduling response without requiring transport reconciliation. The same-Editor/same-mutation ambiguous-disconnect reconciliation path remains separately covered by the Node bridge tests. The live gate proves the selected `[UnityTest]` actually observed `Application.isPlaying == true` across a yielded frame, then returned the Editor to exact stable Edit Mode without changing the user's Enter Play Mode settings.

The previous dedicated live MCP `verify:test-runner` EditMode gate also passed on Unity 6000.3.21f1. Observed evidence:

```text
assemblyName: EunSung.UnityAiBridge.Editor.Tests
exactTestName: UnityAiBridge.Tests.Editor.TestRunnerControlTests.Get_RejectsMalformedOrUnknownMutationIdsWithoutStartingTests
runGuid: 4ecc23df-167d-4f51-924b-d4bab3177847
initialStatus: scheduled
immediateReplayReadOnly: true
terminalStatus: completed
resultState: Passed
selectedTestCaseCount: 1
passCount: 1
failCount: 0
skipCount: 0
inconclusiveCount: 0
issueCount: 0
issuesTruncated: false
completedReplayReadOnly: true
runGuidStableAcrossReplays: true
conflictingSameIdSelectionRejected: true
finalPlayModeState: edit
projectMutationClaimedByBridge: false
```

The first live EditMode Test Runner attempt correctly executed one filtered test (`passCount=1`) but exposed a payload bug: `RunStarted().TestCaseCount` represented the full loaded test tree rather than the actual filtered terminal selection. The bridge now defines terminal `selectedTestCaseCount` as `pass + fail + skip + inconclusive`; a dedicated regression test raised the real Unity baseline from 97/97 to 98/98 before the EditMode slice was marked Verified.

The dedicated live MCP `verify:play-mode` gate previously passed on Unity 6000.3.21f1. Observed evidence:

```text
initialMode: edit
finalMode: edit
enterChanged: true
enterReplayReadOnly: true
enterReconciled: true
enterReloadObserved: true
enterInitialConnectionGeneration: 1787569109635
enterFinalConnectionGeneration: 1787569158803
staleExpectedModeRejected: true
staleAttemptLeftPlayModeUnchanged: true
exitChanged: true
exitReplayReadOnly: true
exitReconciled: true
exitReloadObserved: false
exitInitialConnectionGeneration: 1787569158803
exitFinalConnectionGeneration: 1787569158803
enterPlayModeOptionsEnabled: false
disableDomainReload: false
disableSceneReload: false
userEnterPlayModeSettingsPreserved: true
exactFinalEditStateRestored: true
```

A connection-generation change is an observed lifecycle outcome, not a mandatory success condition. The verified gate intentionally accepts stable native completion whether or not a particular Enter/Exit transition reloads the scripting domain; this is necessary because Unity Enter Play Mode settings and lifecycle details can change reload behavior.

The dedicated live MCP `verify:script-replace` gate previously passed on Unity 6000.3.21f1 after verifier timeout hardening. Observed evidence:

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

The first Script-replace live run on a slower machine exposed a verifier-layer timeout mismatch: the MCP SDK's default 60-second request timeout could expire while Unity legitimately performed import, compilation, domain reload, and reconnect. The verifier was hardened to use explicit longer tool-call timeouts, wait for Script capabilities before guarded recovery, precompute the intended modified SHA, and preserve an exact pre-mutation recovery copy until exact restoration succeeds. This was a verifier/orchestration issue, not evidence of a failed Unity write contract.

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
| `editor.status` / `unity_get_status` | **Verified** | Live Editor/project/scene/compile state plus four-state Play Mode lifecycle (`edit`, `entering_play`, `play`, `exiting_play`), pause state, effective Domain/Scene Reload policy, Agent capabilities, and scene state token. |
| Play Mode control | **Verified** | PR #46; `editor.playMode.set` / `unity_set_play_mode`; exact stable-state preconditions, mutation journal, same-id reconciliation, optional reload/reconnect observation, stale expected-mode rejection, user Enter Play Mode settings preserved, no automatic scene save/Undo claim. Real Unity **93/93** plus live `edit -> play -> edit` MCP gate PASS. |
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
| Script replace/write | **Verified** | PR #45; `script.replace` / `unity_replace_script`; existing `Assets/*.cs` only, mandatory path + GUID + raw SHA-256 CAS, bounded complete-source replacement, editability checks, prepared/written journal, atomic replacement, compile outcome separation, reload/reconnect reconciliation, same-id read-only replay, stale-content rejection, post-reload readback, guarded recovery. Real Unity **89/89** plus live MCP CAS/write/reload/replay/stale/restore gate PASS. |
| Prefab inspect/instantiate | Verified | PR #28; bounded Prefab Asset hierarchy inspect, dependency-hash precondition, linked `PrefabUtility.InstantiatePrefab`, native linkage readback, same-id replay, Undo, stale-replay rejection. |
| Prefab Asset creation | Verified | PR #29; create-only `SaveAsPrefabAsset`, source unchanged, GUID/dependencyHash/root readback, same-id replay, manual asset removal followed by stale-replay rejection. |
| Package Test Runner discovery bootstrap | **Verified** | Development Local/LocalTarball/Git installs self-add `com.eunsung.unity-ai-bridge` to project `testables`; guarded package reimport handles Test Framework refresh. Latest expanded EditMode suite completed **100/100**. |
| Prefab single-property override apply | **Verified** | PR #36 + harness hardening #37–#40; 80/80 real Unity integration and dedicated PR #42 live MCP E2E PASS. |
| Direct `Undo.RecordObject` Prefab-instance writes | **Verified** | #41 / PR #43. `PrefabUtility.RecordPrefabInstancePropertyModifications` is guarded to non-asset scene Prefab instances. Real integration verifies `m_LocalScale` and `m_IsActive` overrides persist after scene save; historical milestone **81/81**. |
| EditMode Test Runner control | **Verified** | PR #47; `test.run.editMode.start` / `test.run.get`, MCP `unity_start_editmode_tests` / `unity_get_test_run`; exact assembly + optional exact test names, asynchronous run handle, SessionState result journal, bounded result details, same-id replay without duplicate scheduling, conflict rejection, and stable Edit-mode precondition. Historical real Unity **98/98** plus live one-test schedule/poll/replay/result gate PASS. |
| PlayMode Test Runner control | **Verified** | PR #48; `test.run.playMode.start`, MCP `unity_start_playmode_tests`, shared `unity_get_test_run`; Unity Test Framework owns Edit -> Play -> Edit, same-session journal/replay survives lifecycle reconnects, exact runtime-capable assembly selection, one-frame `Application.isPlaying` proof, conflict rejection, final Edit Mode/settings preservation. Real Unity **100/100 EditMode + 1/1 PlayMode** plus live MCP gate PASS. |
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
14. **Reload-aware Play Mode control — PR #46** — **93/93** plus live MCP `verify:play-mode` edit/play/replay/stale/restore PASS, verified 2026-08-24
15. **Bounded EditMode Test Runner control — PR #47** — **98/98** plus live MCP `verify:test-runner` schedule/poll/replay/result/conflict PASS, verified 2026-08-24
16. **Bounded PlayMode Test Runner control — PR #48** — **100/100 EditMode + 1/1 PlayMode** plus live MCP `verify:playmode-tests` lifecycle/replay/result/conflict/final-restore PASS, verified 2026-08-24

### Verified Play Mode control contract

`editor.playMode.set` / `unity_set_play_mode` treats Play Mode as an asynchronous Editor lifecycle rather than a Boolean write.

```text
editor.status observation
 -> exact stable expected mode: edit | play
 -> target mode: edit | play
 -> validate mutationId + lifecycle precondition
 -> record retry journal before transition request
 -> Unity EnterPlaymode / ExitPlaymode request
 -> tolerate optional domain reload / bridge disconnect
 -> same-editor reconnect/reconciliation
 -> wait for stable native target mode
 -> same-id replay remains readback-only
 -> stale expected mode fails closed
```

Verified first-slice behavior:

- `editor.status` distinguishes `edit`, `entering_play`, `play`, and `exiting_play`.
- Pause state and effective Enter Play Mode Domain/Scene Reload policy are observable.
- The tool never changes the user's Enter Play Mode settings.
- Only stable `edit`/`play` states are accepted as target and expected precondition values.
- Same-id retries reconcile native state and never blindly request Enter/Exit twice.
- A connection-generation change is reported but is not required for success.
- The tool does not automatically save scenes and does not claim Unity Undo.
- The live gate restores exact final stable Edit Mode.
- Long bounded timeouts are used because lifecycle/reload duration varies by machine and project.

### Verified EditMode Test Runner control contract

`test.run.editMode.start` / `test.run.get` and MCP `unity_start_editmode_tests` / `unity_get_test_run` treat tests as asynchronous jobs rather than holding one MCP call open for the full run.

```text
stable Edit Mode + not compiling
 -> exact test assembly + optional exact full test names
 -> normalize selection + mutationId intent
 -> journal before scheduling
 -> TestRunnerApi.Execute returns Unity runGuid
 -> immediate asynchronous start response
 -> public Test Framework callbacks update SessionState journal
 -> client polls test.run.get
 -> completed/error terminal result
 -> same mutationId remains readback-only
```

Verified first-slice behavior:

- One explicit EditMode test assembly is mandatory; the bridge does not implicitly run the whole project.
- Exact test names are optional and bounded to 64 entries; regex/category/group filters are not exposed yet.
- New runs are rejected while compiling or outside stable Edit Mode.
- One Unity AI Bridge-owned unfinished run is allowed at a time.
- `mutationId` schedules at most once; same-id same-intent replays preserve the Unity `runGuid` and never create a second run.
- Same-id different selection fails with `mutation_id_conflict`.
- Results are journaled in `SessionState` across domain reload in the current Editor process.
- Terminal payloads include actual selected outcome count, pass/fail/skip/inconclusive/assert totals, duration, and at most 100 bounded non-passed leaf details.
- `selectedTestCaseCount` is the terminal outcome total, not `RunStarted().TestCaseCount` from the full loaded tree.
- Arbitrary selected test code can mutate Unity/project state, so test start is operational/write-like and does not claim generic Undo or cleanup.

### Verified PlayMode Test Runner control contract

`test.run.playMode.start` / `test.run.get` and MCP `unity_start_playmode_tests` / `unity_get_test_run` extend the same asynchronous job model across the Unity Test Framework's Edit -> Play -> Edit lifecycle.

```text
stable Edit Mode + not compiling
 -> exact runtime-capable PlayMode test assembly + optional exact full test names
 -> mode-specific mutationId intent journal
 -> TestRunnerApi.Execute(TestMode.PlayMode)
 -> possible domain reload / bridge reconnect
 -> same-editor, same-mutation reconciliation if start delivery is ambiguous
 -> callbacks update the same SessionState run journal
 -> client polls through transient lifecycle disconnects
 -> completed/error terminal result
 -> Unity Test Framework restores Edit Mode
 -> same-id replay remains readback-only
```

Verified first-slice behavior:

- A new PlayMode run is scheduled only from stable Edit Mode; Unity Test Framework owns the lifecycle transition rather than wrapping the run with a second independent Play Mode tool mutation.
- One explicit PlayMode test assembly is mandatory; optional exact test names use the same 64-entry bound.
- Same mutationId + same normalized mode/assembly/selection never schedules twice; conflicting same-id intent fails closed.
- Lifecycle/reconnect ambiguity preserves the same mutationId and same Editor identity.
- The dedicated live verifier assembly is runtime-capable and its `[UnityTest]` proves `Application.isPlaying` is true before and after yielding one frame.
- Terminal result returned one selected pass and zero failures/skips/inconclusive/issues.
- Immediate and completed replay preserved one stable Unity `runGuid`.
- Final native Editor state returned to stable Edit Mode and the user's Enter Play Mode settings were unchanged.
- This slice is Editor-hosted PlayMode only; standalone Player execution is not implied.

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

1. diagnostics extensions where they unlock real workflows,
2. explicit Undo/recovery tools where useful to clients,
3. broader tool-schema compatibility tests as the surface grows,
4. bounded Test Runner selection/cancellation extensions only when their contracts are clear,
5. only then consider broader Prefab apply/revert slices when bounded contracts are clear.

No arbitrary C# execution fallback is planned.

## Known limitations / future work

- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized; live verifiers that require durable scene-object IDs should use a saved active Scene.
- `SessionState` mutation lifecycle does not survive a full Unity Editor restart.
- Play Mode control currently covers stable Edit/Play transitions and observation only; pause/step control, Play Mode settings mutation, standalone-player control, and full Editor-restart recovery are not implemented.
- A Play Mode transition may or may not change the bridge connection generation. Callers must use the terminal native lifecycle state rather than infer success from reconnect behavior alone.
- Test Runner control requires one exact assembly and bounded exact test names, stores run journals only for the current Editor process, and allows only one bridge-owned unfinished run at a time across EditMode and PlayMode.
- Public Test Framework callbacks do not include the Unity run GUID. The current slices correlate callbacks using the single active bridge journal plus exact mode/assembly/test selection; an externally started indistinguishable run for the same selection can therefore remain ambiguous without relying on private Test Framework internals.
- Regex/category/group filters, arbitrary target-platform/standalone Player runs, cancellation, and full Editor-restart Test Runner recovery are not implemented.
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
