# Test discovery verification gate

Candidate: PR #49 / `feature/test-runner-discovery`.

This document is a candidate verification procedure, not proof of runtime support. Do not mark `test.list` / `unity_list_tests` Verified until the real Unity gates below pass.

## Environment

- Windows
- Unity 6000.3.21f1
- package installed/testable as `com.eunsung.unity-ai-bridge`
- stable Edit Mode

## 1. Compile and ordinary regression

After switching to the candidate branch, allow package refresh, C# compilation, and domain reload to finish.

PASS requires:

- no Unity AI Bridge compile errors,
- `EunSung.UnityAiBridge.Editor.Tests` remains visible,
- `EunSung.UnityAiBridge.PlayMode.Tests` remains visible,
- full EditMode package suite:

```text
104 Passed
0 Failed
```

The four new EditMode tests validate discovery string/bounds behavior only. They do not recursively invoke Test Framework discovery inside the ordinary suite.

The dedicated PlayMode verifier assembly itself is unchanged from PR #48; a new manual 1/1 PlayMode rerun is not required solely for this read-only discovery slice unless the live gate exposes a PlayMode-discovery problem.

## 2. Live MCP discovery gate

With Unity open in stable Edit Mode:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:test-discovery
```

The verifier uses the official MCP TypeScript client and must prove:

1. `unity_list_tests` is advertised and live `test.list` capability is present,
2. EditMode assembly discovery includes `EunSung.UnityAiBridge.Editor.Tests`,
3. its native Test Framework test-case count is at least the 104-test candidate baseline,
4. filtering `TestDiscoveryControlTests` returns exactly four deterministic leaf full names,
5. those full names are directly selectable by the current exact-run contract,
6. one-result paging returns distinct, ordinally increasing first/second leaf names with correct `nextOffset`/`truncated` metadata,
7. PlayMode assembly discovery includes `EunSung.UnityAiBridge.PlayMode.Tests` with exactly one test,
8. PlayMode leaf discovery returns exact full name `UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode`,
9. an unknown exact assembly fails with `test_assembly_unavailable`,
10. final Editor state remains stable Edit Mode,
11. the scene state epoch/revision token is unchanged across discovery reads.

No sentinel asset, test execution, Play Mode transition, or project cleanup should be needed.

## Expected PASS summary

The verifier prints a final JSON block similar to:

```text
[Unity AI Bridge] Test discovery MCP end-to-end reliability PASS:
{
  "unityVersion": "6000.3.21f1",
  "editAssembly": "EunSung.UnityAiBridge.Editor.Tests",
  "editAssemblyTestCaseCount": 104,
  "discoveryContractTestCount": 4,
  "deterministicDiscoveryOrder": true,
  "pagingVerified": true,
  "playAssembly": "EunSung.UnityAiBridge.PlayMode.Tests",
  "playAssemblyTestCaseCount": 1,
  "exactPlayModeSelector": "UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode",
  "exactPlayModeSelectorSelectable": true,
  "unknownAssemblyRejected": true,
  "finalPlayModeState": "edit",
  "readOnlyStateTokenUnchanged": true,
  "projectMutated": false
}
```

## Exit gate

PR #49 may be marked Verified only after:

```text
EditMode regression: 104/104
Live MCP verify:test-discovery: PASS
```

Record the exact candidate revision and observed live result in `STATUS.md` before merge.
