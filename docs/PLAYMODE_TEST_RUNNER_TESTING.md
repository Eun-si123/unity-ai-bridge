# PlayMode Test Runner verification gate

Candidate: PR #48 / `feature/playmode-test-runner-control`.

This document is a candidate verification procedure, not proof of runtime support. Do not mark PlayMode Test Runner control Verified until the real Unity gates below pass.

## Environment

- Windows
- Unity 6000.3.21f1
- package installed/testable as `com.eunsung.unity-ai-bridge`
- stable Edit Mode before the live gate

## 1. Compile/package discovery

After switching to the candidate branch, allow Package Manager refresh, C# compilation, and domain reload to finish.

PASS requires:

- no Unity AI Bridge compile errors,
- EditMode assembly `EunSung.UnityAiBridge.Editor.Tests` visible,
- PlayMode assembly `EunSung.UnityAiBridge.PlayMode.Tests` visible in Test Runner.

The PlayMode assembly is intentionally runtime-capable (`includePlatforms: []`) rather than Editor-only. The verifier test uses `[UnityTest]`, asserts `Application.isPlaying`, yields one frame, and asserts `Application.isPlaying` again.

## 2. Ordinary EditMode regression

Run the complete installed-package EditMode assembly.

Expected candidate total:

```text
100 Passed
0 Failed
```

The two added EditMode tests validate PlayMode-run intent identity/bounds only. They do not recursively start a real PlayMode Test Framework run from inside the ordinary EditMode suite.

## 3. Direct PlayMode assembly sanity check

In Unity Test Runner, select PlayMode and run:

```text
EunSung.UnityAiBridge.PlayMode.Tests
```

Expected:

```text
1 Passed
0 Failed
```

This is a direct Unity Test Framework sanity gate before the MCP lifecycle gate.

## 4. Live MCP gate

With Unity open in stable Edit Mode:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:playmode-tests
```

The verifier uses the official MCP TypeScript client and checks:

1. `unity_start_playmode_tests` and `unity_get_test_run` are advertised,
2. `test.run.playMode.start` capability is live,
3. exactly `UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode` is selected,
4. Unity Test Framework owns the Edit -> Play -> Edit lifecycle,
5. temporary domain reload/bridge disconnect is tolerated,
6. the same mutationId reconciles without scheduling a second run,
7. one stable Unity runGuid is preserved,
8. terminal result is exactly one clean PlayMode pass,
9. completed same-id replay remains read-only,
10. same mutationId with a different PlayMode selection is rejected,
11. final native Editor state is stable Edit Mode,
12. the user's Enter Play Mode settings are unchanged.

The external lifecycle timeout is 180 seconds so slower machines/projects are not false-failed by a short client timeout. Timeout/disconnect ambiguity must preserve the same mutationId.

## Exit gate

Mark PR #48 PlayMode Test Runner control Verified only after all three real Unity gates pass:

```text
EditMode regression: 100/100
Direct PlayMode assembly: 1/1
Live MCP verify:playmode-tests: PASS
```

Record the exact PR head, Unity version, observed counts, runGuid/replay evidence, final Play Mode state, and settings-preservation evidence in `STATUS.md` and `docs/TESTING.md` before merge.
