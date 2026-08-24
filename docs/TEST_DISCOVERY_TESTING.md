# Test discovery verification gate

PR #49 / `feature/test-runner-discovery`.

**Verification state: Verified on 2026-08-24.**

This document records the real Unity gate for `test.list` / MCP `unity_list_tests`.

## Verified environment

- Windows
- Unity 6000.3.21f1
- package installed/testable as `com.eunsung.unity-ai-bridge`
- stable Edit Mode
- product head exercised by the real Unity gate: `736103567e863eb27f1035c431f6dc6aec023bb7`

## 1. Compile and ordinary regression

After package refresh, C# compilation, and domain reload, the installed-package EditMode suite completed:

```text
105 Passed
0 Failed
```

The five PR #49 EditMode tests validate discovery string/bounds/cursor behavior only. They do not recursively invoke Test Framework discovery inside the ordinary suite.

The dedicated PlayMode verifier assembly was unchanged from PR #48, so no separate manual 1/1 PlayMode rerun was required solely for this read-only slice. PlayMode discovery itself was exercised by the live MCP gate below.

## 2. Live MCP discovery gate

Command:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:test-discovery
```

The official MCP TypeScript client gate passed and proved:

1. `unity_list_tests` was advertised and live `test.list` capability was present,
2. EditMode assembly discovery included `EunSung.UnityAiBridge.Editor.Tests`,
3. the native Test Framework count was exactly 105 for the verified package suite,
4. filtering `TestDiscoveryControlTests` returned exactly five deterministic leaf full names,
5. those full names were directly selectable by the current exact-run contract,
6. one-result paging returned distinct, ordinally increasing first/second leaf names with correct `nextOffset`/`truncated` metadata,
7. a page requested beyond the result end returned no entries without rewinding `nextOffset`,
8. PlayMode assembly discovery included `EunSung.UnityAiBridge.PlayMode.Tests` with exactly one test,
9. PlayMode leaf discovery returned exact full name `UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode`,
10. an unknown exact assembly failed with `test_assembly_unavailable`,
11. final Editor state remained stable Edit Mode,
12. the scene state epoch/revision token was unchanged across discovery reads,
13. the bridge claimed no project mutation.

No sentinel asset, test execution, Play Mode transition, or cleanup was needed.

## Observed PASS evidence

```text
[Unity AI Bridge] Test discovery MCP end-to-end reliability PASS:
{
  "unityVersion": "6000.3.21f1",
  "editAssembly": "EunSung.UnityAiBridge.Editor.Tests",
  "editAssemblyTestCaseCount": 105,
  "discoveryContractTestCount": 5,
  "deterministicDiscoveryOrder": true,
  "pagingVerified": true,
  "pastEndCursorMonotonic": true,
  "firstPageFullName": "UnityAiBridge.Editor.Tests.AssetCommandTests.InspectValidateArguments_AcceptsDocumentedDependencyBounds",
  "secondPageFullName": "UnityAiBridge.Editor.Tests.AssetCommandTests.ProjectPathValidation_RejectsOutsideAssetsAndPackages",
  "playAssembly": "EunSung.UnityAiBridge.PlayMode.Tests",
  "playAssemblyTestCaseCount": 1,
  "exactPlayModeSelector": "UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode",
  "exactPlayModeSelectorSelectable": true,
  "unknownAssemblyRejected": true,
  "finalPlayModeState": "edit",
  "stateEpoch": "cdba6362ce6c44ed89bf271a12fe0150",
  "stateRevision": 121,
  "readOnlyStateTokenUnchanged": true,
  "projectMutated": false
}
```

## Verified contract notes

- Test Framework, not source-text inference, is the discovery source of truth.
- The operation is read-only and requires stable Edit Mode/not compiling while retrieval is started.
- `assemblyName` omitted means assembly scope; an exact assembly means leaf-test scope.
- `nameContains` is a bounded case-insensitive substring filter.
- Results use deterministic ordinal ordering and bounded paging (`maxResults <= 200`).
- Paging invariant is always `nextOffset = offset + returnedCount`; past-end offsets return an empty page without moving the cursor backward.
- Exact leaf `fullName` is not truncated. `selectableByBridge` reports whether it fits the current 512-character exact-run selector bound.
- Unknown exact assemblies fail closed.

## Exit gate

```text
EditMode regression: 105/105 — PASS
Live MCP verify:test-discovery — PASS
```

PR #49 satisfies its real Unity verification gate and may be marked Verified/merged after final documentation-only CI passes.