# Unity AI Bridge package tests

The package includes Unity EditMode tests under `Tests/Editor` in the `EunSung.UnityAiBridge.Editor.Tests` test assembly and a dedicated runtime-capable PlayMode verifier assembly under `Tests/PlayMode` as `EunSung.UnityAiBridge.PlayMode.Tests`.

Unity's supported package-test model has two requirements:

1. the package must contain a test assembly marked with `optionalUnityReferences: ["TestAssemblies"]`, and
2. non-embedded package dependencies must be listed in the consuming project's top-level `Packages/manifest.json` `testables` array before Unity Test Framework loads those tests.

Unity AI Bridge handles the second step automatically for development-style installs:

- **Local folder / Add package from disk** — automatically adds `com.eunsung.unity-ai-bridge` to `testables`.
- **Local tarball** — automatically adds it.
- **Git URL dependency** — automatically adds it.
- **Embedded package** — no manifest change is needed because Unity treats embedded packages as development packages.
- **Registry install** — not modified automatically; registry consumers are not forced to compile development tests.

The automatic path preserves existing dependencies and existing testable package names, performs no write when the package is already present, and refuses to rewrite a malformed/non-array `testables` value.

Unity Test Framework does not always immediately discover a package after `testables` changes. When the test assembly is still absent, Unity AI Bridge performs one guarded recursive package reimport per Editor session instead of entering an import loop.

## Verified installed-package behavior

On **2026-08-24**, the non-embedded development-install flow and expanded package suites were reproduced in Unity **6000.3.21f1**:

- automatic project-manifest `testables` registration: PASS
- guarded package reimport / test-assembly discovery: PASS
- `EunSung.UnityAiBridge.Editor.Tests` visible in EditMode Test Runner: PASS
- `EunSung.UnityAiBridge.PlayMode.Tests` visible in PlayMode Test Runner: PASS
- historical EditMode suite milestones: 75/75, 80/80, 81/81, 85/85, 89/89, 93/93, 97/97, 98/98
- current verified EditMode suite after PR #48 PlayMode Test Runner contract coverage: **100 Passed / 0 Failed**
- dedicated PlayMode verifier assembly: **1 Passed / 0 Failed**

`STATUS.md` records the current verified baseline and the exact runtime evidence for each later write/lifecycle/job family.

## Prefab property apply integration test

PR #36 adds an EditMode integration test for the first bounded existing-Prefab asset mutation. The test uses a temporary writable Prefab under `Assets`, creates a real Transform serialized-property override on a linked instance, applies exactly that property, verifies source/instance readback, verifies same-mutation replay, then deletes the temporary asset and proves stale replay fails closed. The temporary scene instance/asset are cleaned in `finally`.

The corresponding real Unity suite and dedicated live MCP verifier passed before the operation was marked Verified.

## Script replace tests

PR #45 adds non-reloading EditMode coverage for the first bounded Script mutation family. The ordinary package suite verifies validation/intent and atomic helper behavior without deliberately triggering a domain reload from inside the test assembly itself.

Real source persistence, Unity compilation, domain reload/reconnect, same-id replay, stale-content rejection, and exact source restoration are verified separately by:

```text
npm --prefix mcp-server run verify:script-replace
```

This separation keeps the normal EditMode suite deterministic while still requiring a real Unity end-to-end gate before `script.replace` is considered Verified.

## Play Mode control tests

PR #46 adds four non-transition EditMode tests for stable-mode validation, four-state Play Mode classification, intent fingerprint stability, and safe Edit-mode no-op replay.

The ordinary EditMode suite intentionally does **not** enter real Play Mode from inside its own test assembly. The actual asynchronous lifecycle, optional domain reload/reconnect, same-id replay, stale expected-mode rejection, settings preservation, and exact final Edit-mode restoration are verified separately by:

```text
npm --prefix mcp-server run verify:play-mode
```

This keeps the package suite deterministic while still requiring a real Editor lifecycle gate before Play Mode control is considered Verified.

## EditMode Test Runner control tests

PR #47 adds bounded validation/intent/journal coverage for asynchronous EditMode Test Runner control. The ordinary package suite deliberately does **not** recursively schedule another Unity Test Framework run from inside its own run; instead it verifies selection validation, normalized mutation identity, unknown-run lookup behavior, and terminal selected-count arithmetic.

The real asynchronous `TestRunnerApi.Execute -> callbacks -> SessionState journal -> MCP polling` path is verified separately by:

```text
npm --prefix mcp-server run verify:test-runner
```

The live gate schedules exactly one safe validation test, verifies one stable Unity `runGuid`, immediate/completed same-id replay without duplicate scheduling, exact terminal counts (`selectedTestCaseCount=1`, `passCount=1`), conflict rejection for a different same-id selection, and final stable Edit Mode.

The first live candidate exposed that `RunStarted().TestCaseCount` represents the full loaded test tree rather than the filtered terminal selection. A dedicated regression test now defines terminal `selectedTestCaseCount` as `pass + fail + skip + inconclusive`, producing the 98/98 EditMode baseline before the slice was marked Verified.

## PlayMode Test Runner control tests

PR #48 adds two non-lifecycle EditMode tests for PlayMode run intent identity/bounds plus a separate runtime-capable PlayMode test assembly.

The ordinary EditMode suite still does not recursively schedule a real PlayMode Test Framework run. Real PlayMode execution is isolated in:

```text
EunSung.UnityAiBridge.PlayMode.Tests
```

whose verifier `[UnityTest]` asserts `Application.isPlaying`, yields one frame, and asserts it again. The direct Unity Test Runner gate completed **1/1**.

The complete MCP lifecycle is verified separately by:

```text
npm --prefix mcp-server run verify:playmode-tests
```

The live gate verifies exact PlayMode selection, Test Framework-owned Edit -> Play -> Edit lifecycle, one stable Unity `runGuid`, immediate/completed same-id replay without duplicate scheduling, conflicting same-id selection rejection, exactly one clean passing terminal result, final stable Edit Mode, preserved Enter Play Mode settings, and proof that the verifier test actually ran inside Play Mode across a frame.

The expanded ordinary EditMode suite completed **100/100** before the PlayMode Test Runner extension was marked Verified.

## Manual fallback

If automatic enabling fails because the project manifest is read-only or otherwise cannot be updated, use:

`Tools > Unity AI Bridge > Enable Package Tests`

or add the package manually while preserving all existing entries:

```json
{
  "dependencies": {
    "com.eunsung.unity-ai-bridge": "file:<path-to-unity-package>"
  },
  "testables": [
    "com.eunsung.unity-ai-bridge"
  ]
}
```

If Test Runner still has not refreshed after Package Manager resolution and compilation finish, use the menu fallback/reimport path and inspect the Console for `[Unity AI Bridge]` bootstrap diagnostics.