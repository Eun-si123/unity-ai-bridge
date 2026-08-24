# PlayMode Test Runner verification gate

Verified: PR #48 / `feature/playmode-test-runner-control` on 2026-08-24.

This document records the repeatable verification procedure and the real Unity evidence used to mark the bounded PlayMode Test Runner slice Verified.

## Verified environment

- Windows
- Unity 6000.3.21f1
- package installed/testable as `com.eunsung.unity-ai-bridge`
- stable Edit Mode before the live gate
- PR #48 product head `00fc44fb0b9e4fac855c5853d2aeb3fe1d7d125c`

## 1. Compile/package discovery

After switching to the candidate branch, Package Manager refresh, C# compilation, and domain reload completed with no Unity AI Bridge compile errors.

Verified discovery:

- EditMode assembly `EunSung.UnityAiBridge.Editor.Tests` visible,
- PlayMode assembly `EunSung.UnityAiBridge.PlayMode.Tests` visible in Test Runner.

The PlayMode assembly is intentionally runtime-capable (`includePlatforms: []`) rather than Editor-only. The verifier test uses `[UnityTest]`, asserts `Application.isPlaying`, yields one frame, and asserts `Application.isPlaying` again.

## 2. Ordinary EditMode regression

The complete installed-package EditMode assembly passed:

```text
100 Passed
0 Failed
```

The two added EditMode tests validate PlayMode-run intent identity/bounds only. They do not recursively start a real PlayMode Test Framework run from inside the ordinary EditMode suite.

## 3. Direct PlayMode assembly sanity check

Unity Test Runner PlayMode run:

```text
EunSung.UnityAiBridge.PlayMode.Tests
```

passed:

```text
1 Passed
0 Failed
```

This independently proves the dedicated PlayMode verifier assembly is discoverable and runnable before the MCP lifecycle gate.

## 4. Live MCP gate

Command:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:playmode-tests
```

The official MCP TypeScript client gate passed. Observed terminal evidence:

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

`initialDeliveryReconciled=false` is a normal observed outcome: this run returned the initial scheduling response without requiring transport reconciliation. The ambiguous disconnect/reconnect reconciliation path is independently covered by the Node bridge tests and remains part of the contract.

The verifier proves:

1. `unity_start_playmode_tests` and `unity_get_test_run` are advertised,
2. `test.run.playMode.start` capability is live,
3. exactly one named PlayMode test is selected,
4. Unity Test Framework owns the Edit -> Play -> Edit lifecycle,
5. lifecycle/domain-reload disconnects are treated as transient and same-mutation reconciliation is available,
6. one stable Unity runGuid is preserved across immediate and completed same-id replay,
7. terminal result is exactly one clean PlayMode pass,
8. same mutationId with a different PlayMode selection is rejected,
9. final native Editor state is stable Edit Mode,
10. the user's Enter Play Mode settings are unchanged,
11. the verifier test actually observed `Application.isPlaying == true` across a yielded frame.

The external lifecycle timeout is 180 seconds so slower machines/projects are not false-failed by a short client timeout. Timeout/disconnect ambiguity must preserve the same mutationId.

## Exit gate

PR #48 satisfies the real Unity exit gate:

```text
EditMode regression: 100/100
Direct PlayMode assembly: 1/1
Live MCP verify:playmode-tests: PASS
```

PlayMode Test Runner control may therefore be recorded as **Verified** for Windows + Unity 6000.3.21f1. Broader Unity/OS compatibility is not implied.
