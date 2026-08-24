# Test Runner control contract

This document defines the first bounded Unity Test Framework control slice for bridge protocol v0.

Implemented operations:

- `test.run.editMode.start` — schedule one explicit EditMode test selection,
- `test.run.get` — read the current/terminal result journal for that run.

The MCP adapters are `unity_start_editmode_tests` and `unity_get_test_run`.

## Why start/get are separate

Unity test runs are asynchronous and can be long-running. Holding one transport/MCP request open until every test finishes would turn normal slow tests into timeout ambiguity.

The first slice therefore uses a handle-style workflow:

```text
test.run.editMode.start
 -> mutationId + Unity runGuid + scheduled/running state
 -> Unity Test Framework callbacks
 -> SessionState result journal
 -> test.run.get polling
 -> completed/error terminal result
```

`mutationId` is the bridge retry identity. `runGuid` is Unity Test Framework's run identity returned by `TestRunnerApi.Execute`.

## `test.run.editMode.start`

Risk: `write`.

The bridge itself does not edit a scene or asset, but executing arbitrary selected test code can mutate Editor/project state. Results therefore conservatively report `dirtyState=unknown`, and the bridge makes no Undo or automatic cleanup claim for arbitrary tests.

Arguments:

- `assemblyName` — required exact Unity test assembly name without `.dll`, 1..256 characters,
- `testNames` — optional exact full test names, at most 64 entries, each 1..512 characters,
- `mutationId` — required at the Unity bridge layer, 1..128 characters using letters, digits, `-`, `_`, `.`, or `:`. MCP may generate it when omitted by a caller.

First-slice bounds intentionally exclude:

- implicit project-wide runs,
- PlayMode tests,
- regex/group filters,
- category filters,
- arbitrary target-platform/player test execution.

Preconditions:

- Unity must not be compiling,
- Editor Play Mode lifecycle must be stable `edit`,
- Unity AI Bridge must not already own another unfinished test run in this Editor session.

Retry behavior:

- the run intent is normalized to exact assembly + sorted/distinct exact test names,
- same `mutationId` + same normalized intent returns the existing journal with `replayed=true`,
- same `mutationId` + different intent fails with `validation/mutation_id_conflict`,
- a same-id retry never schedules a second Unity test run.

## `test.run.get`

Risk: `read`.

Arguments:

- `mutationId` — exact bridge run identity from the start request.

The journal is stored in Unity Editor `SessionState`. It survives script-domain reload inside the current Editor process but does not survive a full Editor restart.

Possible status values:

- `scheduled`
- `running`
- `completed`
- `error`

## Result payload

Both operations return the same bounded result shape:

- `mutationId`
- `replayed`
- `runGuid`
- `status`
- `testMode` (`edit` in this slice)
- `assemblyName`
- normalized `testNames`
- request/start/finish Unix-millisecond timestamps
- `selectedTestCaseCount`
- root `resultState`
- total duration seconds
- pass/fail/skip/inconclusive/assert counts
- `issues` — non-passed leaf-test details only, at most 100
- `issuesTruncated`
- `errorMessage` for run-level framework/prebuild errors

For a terminal `completed` result, `selectedTestCaseCount` is the actual number of terminal test outcomes represented by `passCount + failCount + skipCount + inconclusiveCount`. It is **not** copied from `ICallbacks.RunStarted(ITestAdaptor).TestCaseCount`, because Unity's public callback receives the full loaded test tree even when the execution filter selects only one test. While a run is only `scheduled` or `running`, the first slice leaves this count at `0` rather than reporting a misleading loaded-tree size.

Each issue contains:

- `fullName`
- `resultState`
- duration
- message
- stack trace
- output

Message/stack/output are individually truncated to 8,000 characters.

Passing leaf tests are not repeated individually; aggregate counts are the normal compact success representation.

## Callback and reload behavior

Unity Test Framework callbacks are not preserved through domain reload. Unity AI Bridge registers its public `IErrorCallbacks` listener from an `[InitializeOnLoad]` type in every loaded domain and stores run state/result data in `SessionState`.

The implementation deliberately uses public Test Framework APIs compatible with the 1.4 line (`TestRunnerApi.Execute`, `RegisterTestCallback`, `Filter`, `ExecutionSettings`, `ITestAdaptor`, `ITestResultAdaptor`, `IErrorCallbacks`) rather than relying on internal Test Framework runners or newer-only API helpers.

## Concurrency limitation

The public 1.4 callback interface does not include the Unity run GUID in `RunStarted`/`RunFinished`. The first slice therefore correlates callbacks using the single bridge-owned active journal plus the exact requested assembly/test selection.

Unity AI Bridge refuses to start two owned runs concurrently. However, if an external/manual actor starts an indistinguishable run for the **same exact selection** while a bridge-owned run is active, public callback metadata may be insufficient to distinguish the two. This remains an explicit first-slice limitation; the bridge does not use private Test Framework internals to guess.

## Verification requirement

Source presence is not enough to mark this slice Verified. Required evidence is:

1. Node/protocol CI PASS,
2. expanded real Unity 6000.3.21f1 EditMode suite PASS,
3. dedicated live MCP start/poll/completion/replay gate PASS.
