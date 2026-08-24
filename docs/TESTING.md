# Testing Guide

This document defines the repeatable verification path for Unity AI Bridge. It separates automated Node/protocol checks, Unity EditMode tests, and real Editor/end-to-end verification so implementation is never mistaken for runtime proof.

## 1. Automated Node / protocol verification

Run from the repository root:

```text
npm --prefix mcp-server ci
npm run build
npm test
```

Coverage grows with the tool surface and should include protocol/version guards, local bridge startup, hello/route handling, request/result correlation, input/schema bounds, tool routing, no-editor failures, stale-generation handling, and domain-specific bridge contracts.

GitHub Actions is the canonical CI environment for this Node/protocol layer unless a workflow explicitly runs Unity as well.

## 2. Real Unity 6000.3.21f1 package compile check

Target editor: Unity 6000.3.21f1.

1. Open a clean Unity project with Unity 6000.3.21f1.
2. Add `unity-package/package.json` using Package Manager -> Add package from disk, or install the package through the Git dependency path being tested.
3. Allow Package Manager resolution, script compilation, and any domain reload to finish.
4. Confirm the Unity Console contains zero compile errors caused by Unity AI Bridge.
5. Record warnings separately; warnings are not silently promoted to PASS.

PASS requires the installed package to load and the Editor assembly to compile successfully.

When switching Git branches while Unity remains open, Unity can temporarily keep the previously compiled Editor assembly even though the package source changed. If a newly added operation reports `unsupported/operation_not_supported` but current source contains the route, force package reimport/domain reload or restart Unity before classifying the implementation as missing.

## 3. Installed-package Test Runner discovery check

Unity's package-test behavior differs between embedded and non-embedded packages. For a non-embedded Local, LocalTarball, or Git install, Unity AI Bridge adds `com.eunsung.unity-ai-bridge` to the consuming project's top-level `Packages/manifest.json` `testables` array automatically.

Verification procedure:

1. Start with a Unity project whose `Packages/manifest.json` does **not** already contain `com.eunsung.unity-ai-bridge` in `testables`.
2. Install Unity AI Bridge as a Local/Add-package-from-disk or Git package dependency.
3. Wait for the initial package compile and automatic manifest update.
4. When Test Framework does not immediately load the package test assembly, the bootstrap performs one guarded package reimport for the Editor session.
5. Open **Window -> General -> Test Runner** and select **EditMode**.
6. Confirm assembly `EunSung.UnityAiBridge.Editor.Tests` appears without manually editing the manifest.
7. Confirm the project manifest contains the package exactly once in `testables` and preserves existing dependencies/testable entries.
8. Run the EditMode suite.

Expected automatic sources:

- `PackageSource.Local` — yes
- `PackageSource.LocalTarball` — yes
- `PackageSource.Git` — yes
- `PackageSource.Embedded` — no manifest edit required
- `PackageSource.Registry` — no automatic manifest edit

If automatic enabling cannot update the project manifest, use `Tools > Unity AI Bridge > Enable Package Tests` or add the package manually to the project's `testables` array.

Verified history: 75/75 after Test Runner bootstrap, 80/80 after Prefab-property apply, 81/81 after PR #43 direct scene-Prefab override recording, 85/85 after PR #44 bounded Script read, 89/89 after PR #45 reload-safe Script replace, 93/93 after PR #46 reload-aware Play Mode control, 97/97 on the first PR #47 Test Runner-control candidate, **98/98** after the selected-count regression fix, and **100/100** after PR #48 PlayMode Test Runner contract coverage.

## 4. Unity EditMode suite

After package tests are visible in Test Runner:

1. select **EditMode**,
2. run `EunSung.UnityAiBridge.Editor.Tests`,
3. record passed/failed counts,
4. clean any temporary Assets/objects created by the test or verifier path,
5. do not overwrite the last verified count in `STATUS.md` with a new count unless the exact candidate/environment actually ran.

Latest real Unity evidence:

```text
Date: 2026-08-24
Candidate: PR #48 feature/playmode-test-runner-control
Revision: 00fc44fb0b9e4fac855c5853d2aeb3fe1d7d125c
Environment: Windows + Unity 6000.3.21f1
Action: EditMode Run All
Observed: 100 Passed / 0 Failed
Result: PASS
```

## 5. Bounded Prefab property apply Unity verification gate

PR #36 adds the first persistent existing-Prefab modification: `prefab.property.apply` / `unity_apply_prefab_property_override`. Test-harness compatibility was hardened through PRs #37–#40.

The EditMode integration test creates a temporary Prefab Asset and durable saved test Scene, applies one `m_LocalScale` override, verifies source/instance readback, same-id replay, stale replay after asset deletion, and cleanup. It is Verified as part of the 80/80 real Unity run.

The first slice intentionally excludes `m_Script`, arrays/elements, Model Prefabs, Apply All, component/object-wide apply, and automatic nested-Prefab target selection. Because this operation persistently modifies an existing asset and cannot safely promise generic Unity Undo/rollback, ambiguous execution or failed semantic verification must not trigger blind automatic retry.

## 6. Live MCP Prefab property apply end-to-end gate

Run with Unity open on a saved active Scene:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:prefab-property-apply
```

This uses the official MCP TypeScript client over stdio and checks the real public path: create source object -> add BoxCollider -> create Prefab -> instantiate -> create `m_IsTrigger` instance override -> apply one property -> verify changed dependencyHash -> same-id replay -> fresh independent instance readback -> manual verifier-Prefab deletion -> stale replay rejection -> cleanup.

**Verified evidence:** this live MCP gate passed on 2026-08-24 against Unity 6000.3.21f1. The direct `Undo.RecordObject` Prefab-instance audit discovered while designing it was subsequently fixed by #41 / PR #43 and verified by the 81/81 EditMode run.

## 7. Bounded Script read Unity + MCP gate

PR #44 introduces the first Script workflow as read-only `script.read` / `unity_read_script`.

### EditMode gate

The full PR #44 candidate suite completed:

```text
85 Passed
0 Failed
```

The four Script-read tests verify:

1. Assets and Packages `.cs` paths are accepted,
2. traversal, backslashes, non-script extensions, and paths outside Assets/Packages are rejected,
3. the installed package's `BridgeProtocol.cs` can be read through small chunks while GUID, path, dependencyHash, raw SHA-256, byte count, and character count remain stable,
4. an offset beyond the decoded source length is rejected.

### Live MCP gate

Command:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:script-read
```

No saved Scene or manual Project-window action is required. The verifier starts the normal MCP server over stdio, confirms `unity_read_script`, waits for live `script.read`, reads `Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs` in 64-code-unit chunks, reconstructs the exact source, and verifies stable identity/hash/encoding/size metadata plus immediate repeat stability.

Observed PASS record on 2026-08-24:

```text
unityVersion: 6000.3.21f1
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

The read surface is intentionally bounded: exact `.cs` Unity assets only, Assets/Packages only, strict UTF-8 with optional BOM, at most 4 MiB per source file, at most 100,000 UTF-16 code units returned per call, and paging offsets limited to the C# `int` range.

This gate is **Verified**. GitHub Actions alone was not used as proof of the real Unity behavior.

## 8. Script replace/write Unity + MCP gate

PR #45 introduces the first bounded persistent Script mutation as `script.replace` / `unity_replace_script`.

### EditMode gate

The full candidate suite completed:

```text
89 Passed
0 Failed
```

The four non-reloading Script-replace EditMode tests cover bounded validation/intent and atomic file helper behavior without deliberately reloading the test assembly from inside the ordinary suite. Real compilation/domain reload is instead verified by the dedicated live MCP gate below.

### Live MCP gate

Prepare exactly this dedicated sentinel under the consuming Unity project's `Assets` folder:

```csharp
// UNITY_AI_BRIDGE_SCRIPT_REPLACE_VERIFIER

public static class UnityAiBridgeScriptReplaceVerifier
{
    public const int UnityAiBridgeVerifierValue = 1;
}
```

Then run:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:script-replace
```

The verifier is intentionally restricted to `Assets/UnityAiBridge_ScriptReplaceVerify.cs`. It performs:

1. exact pre-write full Script read and sentinel validation,
2. a pre-mutation exact recovery copy,
3. CAS replace of verifier value `1 -> 2`,
4. Unity import/compile observation,
5. real domain reload + bridge reconnect observation,
6. post-reload GUID/SHA readback,
7. exact same-mutationId replay with no second source write,
8. stale old-SHA write rejection with modified bytes unchanged,
9. CAS restore `2 -> 1`,
10. second compile/reload observation,
11. exact original GUID/SHA/content restoration,
12. removal of the recovery copy only after exact successful restoration.

Observed PASS record on 2026-08-24:

```text
unityVersion: 6000.3.21f1
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

### Timeout / slow-machine requirement

The first live attempt on a slower machine exposed an important verifier/client requirement: the MCP SDK default request timeout can expire while Unity is legitimately performing source import, compilation, domain reload, and reconnect. This is a false timeout, not proof that persistence failed.

The verifier therefore uses explicit longer tool-call timeouts for `unity_replace_script`, waits for Script capabilities to return before guarded recovery, precomputes the intended modified raw SHA before mutation, and preserves a recovery copy until exact restoration succeeds.

For future clients, do **not** assume a short fixed wall-clock timeout is universally safe for reload-bound Unity operations. Machine speed and project size can materially change compilation/reload duration. Ambiguous timeout/disconnect handling must preserve the same mutationId and reconcile current state rather than blindly issuing a new write.

This gate is **Verified** on Windows + Unity 6000.3.21f1.

## 9. Play Mode control Unity + MCP gate

PR #46 introduces reload-aware Editor lifecycle control as `editor.playMode.set` / `unity_set_play_mode`.

### EditMode gate

The four candidate tests cover stable-mode validation, four-state lifecycle classification, retry-intent identity, and safe Edit-mode no-op replay without entering real Play Mode from inside the ordinary test assembly.

Verified candidate result:

```text
93 Passed
0 Failed
```

### Live MCP gate

With Unity open and the candidate package compiled:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:play-mode
```

No sentinel file or manual Play-button action is required. The verifier proves:

1. detailed Play Mode status/capability exposure,
2. stable Edit-mode start,
3. `edit -> play` completion,
4. same enter mutationId replay is readback-only,
5. stale expected-mode rejection while preserving Play state,
6. `play -> edit` completion,
7. same exit mutationId replay is readback-only,
8. exact final stable Edit-mode restoration,
9. user Enter Play Mode settings remain unchanged,
10. optional connection-generation changes are observed but never treated as mandatory proof of success.

Observed PASS record on 2026-08-24:

```text
unityVersion: 6000.3.21f1
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

The production bridge and verifier use a long bounded 180-second lifecycle timeout so slower machines/projects have room to perform legitimate Editor lifecycle work. Ambiguous timeout/disconnect handling preserves the same mutationId and reconciles native state instead of issuing a blind second Enter/Exit request.

This gate is **Verified** on Windows + Unity 6000.3.21f1.

## 10. EditMode Test Runner control Unity + MCP gate

PR #47 introduces bounded asynchronous Unity Test Framework control as `test.run.editMode.start` / `test.run.get`, exposed through MCP as `unity_start_editmode_tests` / `unity_get_test_run`.

### EditMode gate

The package suite intentionally does not recursively schedule a nested Test Framework run from inside itself. Its Test Runner-control tests cover bounded selection validation, normalized intent identity, unknown-run lookup, and terminal selected-count arithmetic.

The first candidate completed 97/97. The first live MCP run then exposed that `RunStarted().TestCaseCount` represents the full loaded tree, not the actual filtered terminal selection. A dedicated regression test and production fix were added before final verification.

Verified current-head result:

```text
98 Passed
0 Failed
```

### Live MCP gate

With Unity open in stable Edit Mode and the candidate package compiled:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:test-runner
```

No sentinel asset or manual Test Runner action is required. The verifier schedules exactly one safe package validation test and proves:

1. Test Runner Agent capabilities are advertised in stable Edit Mode,
2. an exact assembly + exact test name schedules asynchronously and immediately returns a Unity `runGuid`,
3. replaying the same mutationId does not schedule a second Unity run,
4. polling `unity_get_test_run` reaches a terminal `completed` result,
5. exact terminal counts report one selected test and one pass,
6. the same `runGuid` survives immediate and completed replays,
7. reusing the same mutationId for a different selection fails with a conflict,
8. no non-passed issue entries are invented for the passing run,
9. the Editor finishes in stable Edit Mode.

Observed PASS record on 2026-08-24:

```text
unityVersion: 6000.3.21f1
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

The first EditMode slice requires one exact assembly, allows at most 64 exact test names, allows only one bridge-owned unfinished run, and stores the run journal in `SessionState` for the current Editor process. Public Test Framework callbacks do not include the Unity run GUID, so correlation uses the one active bridge journal plus exact requested selection rather than private Test Framework internals.

This gate is **Verified** on Windows + Unity 6000.3.21f1.

## 11. PlayMode Test Runner control Unity + MCP gate

PR #48 extends the verified asynchronous Test Runner job model with `test.run.playMode.start`, exposed as `unity_start_playmode_tests`, while reusing `unity_get_test_run` for result polling.

### EditMode regression gate

The ordinary installed-package EditMode suite completed:

```text
100 Passed
0 Failed
```

The two added EditMode tests validate PlayMode-run mode-specific intent identity and the same bounded selection rules without recursively starting a PlayMode run.

### Direct PlayMode assembly gate

The runtime-capable package test assembly:

```text
EunSung.UnityAiBridge.PlayMode.Tests
```

completed in Unity Test Runner PlayMode:

```text
1 Passed
0 Failed
```

Its exact verifier test is a `[UnityTest]` that asserts `Application.isPlaying`, yields one frame, and asserts it again.

### Live MCP gate

With Unity open in stable Edit Mode:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:playmode-tests
```

Observed PASS record on 2026-08-24:

```text
unityVersion: 6000.3.21f1
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

The live gate proves exactly one PlayMode test result, stable run identity across immediate/completed replay, conflicting same-id rejection, final stable Edit Mode, unchanged Enter Play Mode settings, and actual `Application.isPlaying` execution across a frame. `initialDeliveryReconciled=false` is the observed normal fast path; same-Editor/same-mutation ambiguous start reconciliation is separately covered by Node bridge tests.

The PlayMode start and verifier use a bounded 180-second lifecycle timeout so slower machines/projects are not falsely failed by a short client timeout. PlayMode Test Framework lifecycle disconnects must preserve the same mutationId rather than create a fresh run intent.

This gate is **Verified** on Windows + Unity 6000.3.21f1. See [`PLAYMODE_TEST_RUNNER_TESTING.md`](PLAYMODE_TEST_RUNNER_TESTING.md) for the dedicated repeatable gate.

## 12. Real local bridge + `editor.status` verification helper

With the Unity project open and the package loaded:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:unity
```

The helper listens on the local bridge, waits for the real Unity Editor hello, sends `editor.status`, and prints structured Unity/project/scene/play/compile state. This verifies the real WebSocket/bridge path, not MCP stdio by itself.

## 13. Real MCP `unity_get_status` end-to-end check

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:mcp-unity
```

The official MCP client launches the normal server, completes MCP initialization, calls `unity_get_status`, and validates its structured result against the live Editor.

## 14. Reconnect / domain reload / stale-generation check

```text
npm --prefix mcp-server run verify:reconnect
```

When prompted, trigger a Unity script/domain reload. PASS requires the same editor identity to reconnect with a new connection generation, an intentionally old-generation route to fail with `routing/stale_connection`, and a current-generation status call to succeed.

## 15. Hierarchy and object-resolution checks

Hierarchy:

```text
npm --prefix mcp-server run verify:hierarchy
```

Stable resolver / stale replay:

```text
npm --prefix mcp-server run verify:resolver
```

If an operation exists in checked-out source but Unity reports it unsupported, treat stale compiled package state as a candidate first; reimport/restart and re-run before concluding the operation is absent.

## 16. Phase 3 domain verification

Each new write/lifecycle/job family must carry the Phase 2 reliability contract appropriate to its domain before being marked Verified:

- capability/version preflight,
- stable target or lifecycle/job-state identity,
- current-state/content preconditions where required,
- main-thread execution where required,
- explicit risk/persistence classification,
- Undo grouping where applicable,
- mutation identity/replay behavior,
- native semantic/lifecycle/result readback,
- rollback + rollback verification where safe and applicable,
- conservative ambiguous-outcome behavior where a persistent/lifecycle operation cannot safely provide generic rollback,
- deadline/timeout behavior,
- dirty/save/compile/reload semantics,
- real Unity verification in addition to simulated/Node tests.

Domain-specific verifier scripts and exact evidence belong in `STATUS.md` / linked docs rather than being inferred from source presence.

## 17. Evidence format

Every real verification entry added to `STATUS.md` should record:

```text
Date:
Revision/candidate:
Environment:
Action/command:
Expected:
Observed:
Result: PASS / FAIL / PARTIAL
Notes:
```

Do not mark real Unity behavior Verified from Node simulation, source inspection, or a roadmap checkbox alone.
