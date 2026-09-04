# Project Status

Canonical source of truth for what is actually implemented and verified in **Unity AI Bridge**.

Do not infer implementation from README examples, design diagrams, decisions, roadmaps, issues, plans, or other Unity MCP projects. Detailed historical verifier output belongs in the relevant pull request and protocol document; this file tracks the current verified state, important verification boundaries, and the next active work.

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

Phase 2 exit evidence and non-goals are recorded in [`docs/PHASE2_EXIT_GATE.md`](docs/PHASE2_EXIT_GATE.md). Each new Phase 3 family must adopt and verify the reliability contract independently.

## Current verified environment

- Windows
- Unity **6000.3.21f1**
- Node **24.19.0** in GitHub Actions
- Bridge protocol v0
- Unity package version 0.0.1 during the current verification series

Broader Unity/OS compatibility is not implied.

## Latest real Unity verification

The latest expanded installed-package EditMode baseline was verified on **2026-09-04** for PR #58 after the Unity task-journal wire-path fix:

```text
Windows
Unity 6000.3.21f1
135 Passed
0 Failed
```

The subsequent PR #58 Node-side response-normalization changes did not modify the Unity package. The dedicated live MCP gate then passed on PR #58 code head `67e9728c640727c46e618b5da70f7733c73dc50f`:

```text
npm --prefix mcp-server run verify:task-resume
[Unity AI Bridge] Bounded task journal/resume verification PASS
```

Observed verified properties included:

```text
unityVersion: 6000.3.21f1
activeScenePath: Assets/SampleScene.unity
taskBeginReadOnly: true
outOfOrderStepRejectedBeforeMutation: true
wrongArgumentsRejectedBeforeMutation: true
firstStepCompletedAndNextBoundaryExposed: true
secondStepCompleted: true
taskReachedCompletedState: true
externalStateDriftBlockedResume: true
blockedTaskTargetUnchanged: true
```

PR #58 is still open while final documentation-head GitHub verification completes. Runtime verification does not imply that the PR has already been merged to `main`.

## Reliability / recovery progression

Issue #50 tracks the reliability follow-on sequence. Steps 1–4 are merged and verified. Step 5 is runtime-verified in PR #58 and awaiting final merge gates.

| Step | PR | Main merge commit | Status | Verified boundary |
|---|---:|---|---|---|
| Mutation lifecycle status | #52 | `b4d0ddf7356cafa4fe3f9a3d3b9f6464893cf52e` | **Verified** | Read-only `mutation.status` / `unity_get_mutation_status` over the current-session common `EditorMutationLifecycle` journal; real Unity **111/111** + live status gate. |
| First ambiguous-delivery reconciliation | #53 | `affdb042d64b53e95643bb5e37d9402c31d897fd` | **Verified** | `gameObject.create` and `transform.set`; dropped-success-response fault proxy recovered only through completed lifecycle status + exact same-ID operation replay/readback. |
| Broadened common reconciliation | #54 | `d2e442d80964529dc7354f7e07f0eab36017ab64` | **Verified** | Seven reviewed common scene mutations; every first real success response dropped after Unity execution and recovered without blind retry. |
| Bridge action history + safe last-action Undo | #55 | `4cc96efaf06071e4363f562e2ed750f7f9f9d391` | **Verified** | Current-session bounded history, newest bridge action only, exact native Undo evidence; real Unity **119/119** + live Undo gate. |
| Bounded GameObject checkpoint / restore | #56 | `defd88697636e5142a694b6bc4ab587d17096229` | **Verified** | One existing GameObject in one saved active Scene, current-session checkpoint storage, exact parent/scene/state preconditions; real Unity **126/126** + live restore gate. |
| Bounded multi-step task journal / resume | #58 | — open PR | **Verified runtime / merge pending** | Current-session task journal, max 16 tasks / 8 ordered steps, first slice only `gameObject.update` + `transform.set`; real Unity **135/135** + live `verify:task-resume` PASS. |

## Current verified / implemented surface

| Area | Status | Evidence / notes |
|---|---|---|
| Unity package + local bridge | **Verified** | Real compile/load, WebSocket connect/reconnect, main-thread dispatch, stale-route protection, deadlines, and capability preflight exercised on Unity 6000.3.21f1. |
| `editor.status` / `unity_get_status` | **Verified** | Editor/project/scene/compile state, four-state Play Mode lifecycle, pause state, effective Enter Play Mode reload policy, capabilities, and scene state token. |
| `scene.hierarchy` / `unity_get_hierarchy` | **Verified** | Bounded hierarchy with `GlobalObjectId` and truncation metadata. |
| `object.resolve` / `unity_resolve_object` | **Verified** | Native `GlobalObjectId` re-resolution; missing/Undone targets return `found=false`. |
| `editor.diagnostics` / `unity_get_diagnostics` | **Verified** | Bounded Console/compiler diagnostics with source-location metadata where Unity supplies it. |
| State revision / stale-state protection | **Verified** | Session epoch + monotonic revision preconditions reject stale scene writes before mutation. |
| Common mutation transaction | **Verified** | Main-thread preflight, Undo grouping, semantic verification, rollback, rollback verification, retry identity, and execution-boundary deadline protection for adopted write families. |
| Mutation lifecycle status | **Verified** | PR #52. Read-only current-session common lifecycle observation; unknown IDs fail closed; `safeToBlindRetry=false`. |
| Common mutation delivery reconciliation | **Verified** | PRs #53–#54. Allowlist: `gameObject.create`, `gameObject.update`, `gameObject.delete`, `transform.set`, `component.add`, `component.property.set`, `component.remove`. Timeout/disconnect ambiguity is reconciled only through same Editor + lifecycle status + exact same-ID operation replay/readback. |
| Bridge action history | **Verified** | PR #55. SessionState-backed, current Editor session, newest-first, public read surface bounded to 1..32 results; only seven reviewed common scene mutation families are recorded. |
| Safe last-action Undo | **Verified** | PR #55. Only the exact newest bridge-owned action may be undone when fresh state token, scene, Unity Undo group/name, compile state, and Play Mode state still match. No arbitrary historical Undo. |
| Bounded GameObject checkpoint capture/get | **Verified** | PR #56. Current-session SessionState storage, at most 16 retained checkpoints, deterministic bridge-generated checkpoint IDs, capture/get are read-only for Unity Scene state. |
| Bounded GameObject checkpoint restore | **Verified** | PR #56. Restores only name, `activeSelf`, local position/rotation/scale for the same still-existing GameObject in the same saved active Scene and same direct parent. Deleted/reparented targets fail closed. |
| Bounded multi-step task journal / resume | **Verified runtime / merge pending** | PR #58. `task.begin` / `unity_begin_task` and `task.get` / `unity_get_task_status`; max 16 current-session tasks, max 8 steps, only existing-GameObject `gameObject.update` + `transform.set`; exact reserved mutation IDs and state boundaries; no auto-execution/retry/rollback. |
| Dirty-state reporting | **Verified** | Rollback dirty residue is reported explicitly. |
| Dirty-state restoration | **Not implemented** | Undo-based rollback can leave a previously clean scene dirty. |
| Explicit active-scene save | **Verified** | Existing saved path only; exact path/state preconditions; native post-save verification; no interactive Save As. |
| Transform read/write | **Verified** | PR #22 baseline plus later regression coverage. PR #43 verifies direct scene-Prefab Transform writes record real Prefab overrides. |
| GameObject create/update/delete | **Verified** | Create baseline from Phase 1; update/delete from PR #23; current common transaction/reconciliation coverage applies to the reviewed scene-write contracts. |
| Component inspect | **Verified** | PR #24; native-order Components, Missing Script reporting, bounded visible serialized properties, Component identity/ownership. |
| Component add/remove | **Verified** | PR #25; exact Component types/identities, Undo, native verification and replay protection. |
| Component property edit | **Verified** | PR #26; visible Boolean/Integer/Float/String/Vector3 serialized-property writes with semantic readback and Undo/replay protection. |
| Asset search/inspect | **Verified** | PR #27; bounded `AssetDatabase` search and exact GUID/type/importer/dependency inspection. |
| Script read | **Verified** | PR #44; exact `.cs` Unity assets under Assets/Packages, canonical GUID/path + MonoScript validation, strict UTF-8/BOM handling, raw SHA-256, dependencyHash, bounded paging and 4 MiB source-size cap. Historical real Unity **85/85** + live reconstruction/non-mutation gate. |
| Script replace/write | **Verified** | PR #45; existing `Assets/*.cs` only, GUID + raw SHA-256 CAS, atomic replacement, compile/reload observation, same-id reconciliation, stale-content rejection, guarded recovery. Historical real Unity **89/89** + live write/reload/restore gate. |
| Prefab inspect/instantiate | **Verified** | PR #28; bounded Prefab hierarchy inspect, dependency-hash precondition, linked instantiate, native linkage readback, same-id replay, Undo, stale-replay rejection. |
| Prefab Asset creation | **Verified** | PR #29; create-only `SaveAsPrefabAsset`, source unchanged, GUID/dependencyHash/root readback, same-id replay, stale replay after manual removal. |
| Prefab single-property override apply | **Verified** | PR #36 + harness hardening #37–#40; historical **80/80** real Unity integration + PR #42 live MCP gate. |
| Direct `Undo.RecordObject` Prefab-instance writes | **Verified** | #41 / PR #43; explicit `PrefabUtility.RecordPrefabInstancePropertyModifications` for non-asset scene Prefab instances; historical **81/81** milestone. |
| Play Mode control | **Verified** | PR #46; exact stable-state preconditions, same-id reconciliation across optional reload/reconnect, stale expected-mode rejection, user Enter Play Mode settings preserved. Historical **93/93** + live edit→play→edit gate. |
| Installed-package Test Runner bootstrap | **Verified** | Development Local/LocalTarball/Git installs self-add the package to project `testables`; guarded package reimport handles Test Framework refresh. Current overall EditMode regression suite is **135/135**. |
| EditMode Test Runner control | **Verified** | PR #47; asynchronous exact assembly/test selection, SessionState run journal, bounded results, same-id no-duplicate scheduling, conflict rejection. Historical **98/98** + live one-test gate. |
| PlayMode Test Runner control | **Verified** | PR #48; Unity Test Framework owns Edit→Play→Edit, same-session journal/replay survives lifecycle reconnects, runtime-capable `[UnityTest]` proved `Application.isPlaying` across a frame. Historical **100/100 EditMode + 1/1 PlayMode** + live gate. |
| Test Framework discovery | **Verified** | PR #49; native EditMode/PlayMode assembly discovery, exact leaf selectors, bounded substring filtering, deterministic paging, fail-closed unknown assembly, stable Edit Mode/read-only state token. Historical **105/105** + live discovery gate. |
| Remote gateway / Easy Connect | **Planned** | Not implemented. |
| Pairing/authentication | **Planned** | Not implemented. |
| Multi-user/editor routing | **Planned** | Current local bridge supports one active editor. |
| ChatGPT integration | **Planned** | Not implemented or submitted. |
| Portable Agent Plugins packaging | **Planned** | Architecture/roadmap decision recorded; no plugin manifest/skills package implemented yet. |
| Open-weight/local-model compatibility | **Deferred target** | MCP remains the boundary; no model runtime/inference server is being added to the Unity core. See [`docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md`](docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md). |

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
9. **Installed-package Test Runner visibility/bootstrap — PRs #31–#35** — **75/75**, verified 2026-08-24
10. **Bounded Prefab property override apply — PR #36 + #37–#40** — **80/80**, plus PR #42 live MCP E2E PASS
11. **Direct scene-Prefab override recording — #41 / PR #43** — **81/81**, verified 2026-08-24
12. **Bounded Script read — PR #44** — **85/85** + live MCP `verify:script-read` PASS, verified 2026-08-24
13. **Reload-safe Script replace — PR #45** — **89/89** + live MCP `verify:script-replace` PASS, verified 2026-08-24
14. **Reload-aware Play Mode control — PR #46** — **93/93** + live MCP `verify:play-mode` PASS, verified 2026-08-24
15. **Bounded EditMode Test Runner control — PR #47** — **98/98** + live MCP `verify:test-runner` PASS, verified 2026-08-24
16. **Bounded PlayMode Test Runner control — PR #48** — **100/100 EditMode + 1/1 PlayMode** + live MCP `verify:playmode-tests` PASS, verified 2026-08-24
17. **Bounded native Test Framework discovery — PR #49** — **105/105** + live MCP `verify:test-discovery` PASS, verified 2026-08-24
18. **Bounded common mutation lifecycle status — PR #52** — **111/111** + live MCP `verify:mutation-status` PASS, verified 2026-09-03
19. **Initial common mutation delivery reconciliation — PR #53** — create + transform response-loss recovery through status + same-ID replay; live fault-proxy PASS, verified 2026-09-03
20. **Seven-operation common mutation reconciliation — PR #54** — create/update/delete/transform/component add/property/remove; every first success response dropped after Unity execution and recovered safely; live fault-proxy PASS, verified 2026-09-04
21. **Bridge action history + safe latest-action Undo — PR #55** — **119/119** + live MCP `verify:action-undo` PASS, verified 2026-09-04
22. **Bounded GameObject checkpoint / restore — PR #56** — **126/126** + live MCP `verify:checkpoint-restore` PASS, verified 2026-09-04
23. **Bounded multi-step task journal / resume — PR #58** — **135/135** + live MCP `verify:task-resume` PASS, runtime-verified 2026-09-04; merge pending final GitHub gates.

### Verified common mutation lifecycle status contract

`mutation.status` / MCP `unity_get_mutation_status` is a read-only recovery-observation surface over the existing common `EditorMutationLifecycle` journal.

Verified boundary:

- journal scope: current Unity Editor process/session;
- coverage: common `EditorMutationTransaction` lifecycle only;
- `found=false` / `not_found` is not proof that Unity never executed anything;
- `safeToBlindRetry` is always false;
- unknown IDs recommend native re-observation rather than retry;
- repeated status reads do not advance the scene state token;
- Script, persistent Prefab/asset, Play Mode, and Test Runner operation-specific journals are not unified into this surface;
- no full Editor-restart durability claim.

### Verified common mutation reconciliation contract

The reviewed automatic reconciliation allowlist is exactly:

- `gameObject.create`
- `gameObject.update`
- `gameObject.delete`
- `transform.set`
- `component.add`
- `component.property.set`
- `component.remove`

For timeout/disconnect ambiguity after delivery may have occurred:

```text
same mutationId
 -> require same Unity editorId
 -> read mutation.status
 -> boundedly observe started
 -> only completed may continue
 -> invoke exact same operation/intent/mutationId
 -> existing operation-specific replay/readback must prove result
 -> otherwise fail closed
```

There is no retry on `not_found`, no new mutation ID, no automatic re-execution after terminal failure/rollback, and no generic Undo in this reconciliation path.

PR #54's live fault proxy deliberately dropped the first real success response for all seven operations **after Unity executed them**, proving this is response-loss recovery rather than mocked result handling.

### Verified bridge action history / safe Undo contract

`action.history` / MCP `unity_get_bridge_action_history` is observational current-session history for verified changed Undo-backed common scene mutations. Results are newest first and the public page size is bounded to 1..32.

`action.undoLast` / MCP `unity_undo_last_bridge_action` is deliberately narrower than generic Undo:

- only the exact newest bridge action can be requested;
- it must not already be undone;
- fresh state epoch/revision must match the recorded post-action state;
- active Scene path must match;
- Unity Undo group and Undo group name must match;
- Unity must not be compiling or in/transiting Play Mode;
- Unity performs `Undo.PerformUndo()` once and verifies the exact Undo event/group/name plus state-token change;
- older entries never become generic historical Undo targets through this surface.

The verified allowlist remains the same seven common scene mutation families. Script, persistent Prefab/asset, Play Mode, Test Runner, and `checkpoint.restore` are outside the safe-action-history allowlist.

### Verified bounded GameObject checkpoint / restore contract

Public surfaces:

- `checkpoint.capture` / `unity_capture_checkpoint`
- `checkpoint.get` / `unity_get_checkpoint`
- `checkpoint.restore` / `unity_restore_checkpoint`

First-slice boundary:

- one existing GameObject;
- current saved active Scene only;
- exact canonical `GlobalObjectId`;
- exact direct parent identity;
- name, `activeSelf`, local position, local rotation, local scale only;
- current Editor SessionState storage, maximum 16 retained checkpoints;
- bridge-generated deterministic `cp-<sha256>` checkpoint IDs;
- capture/get do not advance the Unity scene state token;
- restore requires a fresh state epoch/revision and the same still-resolving target, saved Scene path, and direct parent;
- restore runs through one `EditorMutationTransaction` / Unity Undo group with native verification and rollback verification;
- same-ID completed restore replay is native-readback-only;
- deleted targets are rejected and never recreated;
- reparented targets are rejected rather than applying old local Transform semantics under a new parent.

This is not whole-Scene backup, arbitrary historical rollback, child/component restoration, reparent/sibling restoration, Prefab/asset restoration, or Editor-restart durability.

### Verified bounded multi-step task journal / resume contract

Public surfaces:

- `task.begin` / `unity_begin_task`
- `task.get` / `unity_get_task_status`

First-slice boundary:

- existing GameObjects in the saved active Scene only;
- only `gameObject.update` and `transform.set` steps;
- current Editor `SessionState` storage;
- maximum 16 retained tasks;
- maximum 8 ordered steps per task;
- every step owns a unique pre-reserved existing `mutationId`;
- immutable task intent binds target and operation-specific requested values;
- step 0 requires the exact task-creation state boundary;
- later steps require the exact verified finish boundary of the prior completed step;
- task reservations are enforced inside the existing `EditorMutationLifecycle.Begin` admission path before lifecycle `started` and before Unity side effects;
- `ready` is exposed only when the next exact reserved step is safe now;
- `waiting_reconciliation` never grants blind retry of a `started` mutation;
- external state drift, terminal failure, conflicts, and out-of-order lifecycle state block continuation;
- `completed` requires every reserved step to have verified common lifecycle completion.

The task API never automatically executes, retries, reorders, skips, rolls back, restores checkpoints, or invents replacement mutation IDs. It is not a generic workflow engine and does not survive a full Unity Editor restart.

Unity `JsonUtility` null/default-object artifacts are normalized only at the task wire boundary; unexpected non-default operation-irrelevant values remain invalid rather than silently broadening the contract. See [`bridge-protocol/TASK_JOURNAL_RESUME.md`](bridge-protocol/TASK_JOURNAL_RESUME.md).

## Current next work

PR #58 is runtime-verified and now requires only exact-final-documentation-head GitHub verification plus merge bookkeeping.

After PR #58 merges, the five-step Issue #50 follow-on order is complete. The next Phase 3 slice should be selected from the current roadmap/evidence rather than silently extending the task journal into a generic workflow engine.

No arbitrary C# execution fallback is planned.

## Known limitations / future work

- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized. Live verifiers that require durable scene-object IDs use a saved active Scene. `gameObject.create` fails closed before mutation when the active Scene has no persistent asset path because reliable GlobalObjectId-backed retry/readback semantics are unavailable there.
- The common `EditorMutationLifecycle` / `mutation.status` journal is SessionState-backed and does not survive a full Unity Editor restart. A missing status record never proves an operation did not execute and never makes blind retry safe.
- Automatic common mutation reconciliation is intentionally allowlisted to the seven reviewed scene-edit families. Other operation-specific journals require their own reviewed recovery semantics.
- Bridge action history is current-session only and safe Undo is newest-action-only. It is not arbitrary `undo(mutationId)` and does not walk backward through history.
- Checkpoints are current-session only, retain at most 16 records, and restore only one existing GameObject's bounded local state. They do not recreate deleted targets or restore hierarchy/components/assets.
- Checkpoint capture currently has a defense-in-depth follow-up: Unity-side capture should explicitly reject overlong native GameObject names and non-finite existing Transform values before SessionState persistence. The public MCP validator already rejects malformed/non-finite checkpoint payloads; this does not expand the verified first-slice claim.
- Multi-step task journals are current-session only, retain at most 16 tasks with at most 8 steps each, and currently support only existing-GameObject `gameObject.update` and `transform.set`. They do not auto-execute, auto-retry, auto-rollback, restore checkpoints, or survive a full Editor restart.
- Task retention eviction can remove the task-level resume view while operation-level common mutation lifecycle records remain separately bounded/current-session. Missing task state never authorizes automatic reconstruction or continuation.
- Clean-scene dirty metadata restoration after Undo rollback is not implemented.
- An already-started Unity API call is not force-cancelled when its deadline later expires.
- Play Mode control covers stable Edit/Play transitions and observation only; pause/step control, Play Mode settings mutation, standalone-player control, and full Editor-restart recovery are not implemented.
- A Play Mode transition may or may not change bridge connection generation. Terminal native lifecycle state, not reconnect behavior alone, is authoritative.
- Test Runner control requires one exact assembly and bounded exact test names, stores run journals only for the current Editor process, and allows only one bridge-owned unfinished run at a time across EditMode and PlayMode.
- Public Test Framework callbacks do not include the Unity run GUID. The current slices correlate callbacks using the single active bridge journal plus exact mode/assembly/test selection; an externally started indistinguishable run for the same selection can remain ambiguous without private Test Framework internals.
- Test Framework discovery is stable-Edit-mode only, uses the public 1.4-compatible tree API, returns at most 200 results per page, exposes exact assembly/leaf discovery plus bounded substring filtering, and does not discover standalone Player tests.
- Regex/category/group execution filters, arbitrary target-platform/standalone Player runs, cancellation, and full Editor-restart Test Runner recovery are not implemented.
- Component property edit supports only the explicitly bounded first-slice value kinds; complex serialized forms remain future work.
- Component add deliberately rejects Transform/RectTransform in the current contract.
- Generic importer mutation and generic asset move/rename/delete are not implemented.
- Script read supports strict UTF-8 source only, exact `.cs` Unity assets, at most 4 MiB per source file, and character paging rather than line/symbol parsing.
- Script replace supports only existing editable `Assets/*.cs`, complete bounded replacement content, raw GUID/SHA CAS, and current-session reload reconciliation. Packages are read-only and there is no generic source Undo/rollback claim.
- Script replace compile/domain-reload duration varies substantially by project and machine. Callers that synchronously wait for terminal results need sufficient timeout headroom while same-id reconciliation remains the safety mechanism for ambiguous transport outcomes.
- Prefab Asset creation is create-only under `Assets`, never overwrites an existing asset, and is a persistent disk write without Unity Undo.
- Prefab property apply covers exactly one existing visible non-array override, requires an explicit writable Prefab Asset target, rejects Model Prefabs, and does not claim generic automatic rollback after an ambiguous persistent asset mutation.
- Prefab Apply All, object/component-wide Apply, Revert Overrides, unpacking, variant authoring, and generic asset deletion remain unimplemented.
- Asset `dependencyHash` is imported-state metadata/precondition evidence for the current bounded asset contracts; it is not a general transaction token. Script writes use raw content SHA-256 as the file-content CAS token.
- Recent Console text covers only the current domain-load capture window.
- Unity support beyond 6000.3.21f1 is unverified.
- Multi-editor routing, remote authentication/pairing, remote gateway hosting, and production AI-host integrations remain later-phase work.
- Open-weight/local models remain a later compatibility target through MCP-capable agent runtimes; the Unity core does not own model serving.
