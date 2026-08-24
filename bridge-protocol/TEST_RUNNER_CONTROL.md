# Test Runner control contract

This document defines the bounded Unity Test Framework control surface for bridge protocol v0.

Implemented operations:

- `test.run.editMode.start` — schedule one explicit EditMode test selection,
- `test.run.playMode.start` — schedule one explicit PlayMode test selection from stable Edit Mode,
- `test.run.get` — read the current/terminal result journal for either mode.

The MCP adapters are `unity_start_editmode_tests`, `unity_start_playmode_tests`, and `unity_get_test_run`.

## Why start/get are separate

Unity test runs are asynchronous and can be long-running. PlayMode runs can additionally cross Edit/Play lifecycle and domain-reload/reconnect boundaries. Holding one transport/MCP request open until every test finishes would turn normal slow tests into timeout ambiguity.

The surface therefore uses a handle-style workflow:

```text
test.run.<mode>.start
 -> mutationId + Unity runGuid + scheduled/running state
 -> Unity Test Framework callbacks
 -> SessionState result journal
 -> test.run.get polling
 -> completed/error terminal result
```

`mutationId` is the bridge retry identity. `runGuid` is Unity Test Framework's run identity returned by `TestRunnerApi.Execute`.

## Common start contract

Risk: `write`.

The bridge itself does not promise to edit a scene or asset, but executing arbitrary selected test code can mutate Editor/project state. Results conservatively report `dirtyState=unknown`, and the bridge makes no Undo or automatic cleanup claim for arbitrary tests.

Arguments:

- `assemblyName` — required exact Unity test assembly name without `.dll`, 1..256 characters,
- `testNames` — optional exact full test names, at most 64 entries, each 1..512 characters,
- `mutationId` — required at the Unity bridge layer, 1..128 characters using letters, digits, `-`, `_`, `.`, or `:`. MCP may generate it when omitted by a caller.

Bounds intentionally exclude:

- implicit project-wide runs,
- regex/group filters,
- category filters,
- arbitrary target-platform/player test execution.

Common preconditions:

- Unity must not be compiling,
- Unity AI Bridge must not already own another unfinished test run in this Editor session.

Retry behavior:

- the run intent is normalized to exact mode + assembly + sorted/distinct exact test names,
- same `mutationId` + same normalized intent returns the existing journal with `replayed=true`,
- same `mutationId` + different mode/assembly/selection fails with `validation/mutation_id_conflict`,
- a same-id retry never schedules a second Unity test run.

## `test.run.editMode.start`

The Editor Play Mode lifecycle must be stable `edit` when a new EditMode run is scheduled.

The EditMode slice is **Verified** on Windows + Unity 6000.3.21f1 with the evidence recorded below.

## `test.run.playMode.start`

A new PlayMode run must also be scheduled from stable `edit`. Unity Test Framework then owns the Edit -> Play -> Edit lifecycle for the selected run; Unity AI Bridge does not manually call its own Play Mode control tool around the test run.

The PlayMode start uses the same SessionState journal/callback infrastructure as EditMode. A start response can become transport-ambiguous if PlayMode entry causes a domain reload quickly enough to drop the current bridge connection. The MCP bridge therefore preserves the same `mutationId`, waits for the same Editor identity to reconnect, and re-delivers only as an idempotent reconciliation attempt. Unity sees the existing journal first and does not schedule a second run.

The first PlayMode slice is intentionally Editor-hosted PlayMode only. It does not build or execute a standalone Player.

A dedicated PlayMode test assembly is used for live verification. The verifier test is a `[UnityTest]` that checks `Application.isPlaying == true`, yields one frame, and checks it again, proving the selected test actually ran inside Play Mode rather than merely being labeled as PlayMode metadata.

## `test.run.get`

Risk: `read`.

Arguments:

- `mutationId` — exact bridge run identity from either start request.

The journal is stored in Unity Editor `SessionState`. It survives script-domain reload inside the current Editor process but does not survive a full Editor restart.

Possible status values:

- `scheduled`
- `running`
- `completed`
- `error`

During PlayMode lifecycle/domain reload, a caller may temporarily be unable to reach the Editor. Clients should retry the read after the same Editor reconnects; they must not invent a fresh run mutationId as a transport retry.

## Result payload

All three operations use the same bounded result shape:

- `mutationId`
- `replayed`
- `runGuid`
- `status`
- `testMode` (`edit` or `play`)
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

For a terminal completed result, `selectedTestCaseCount` is defined as the actual terminal outcome total:

```text
passCount + failCount + skipCount + inconclusiveCount
```

It is deliberately **not** copied from `RunStarted().TestCaseCount`, because Unity's public callback supplies the full loaded test tree there even when the execution filter selects a smaller subset.

Each issue contains:

- `fullName`
- `resultState`
- duration
- message
- stack trace
- output

Message/stack/output are individually truncated to 8,000 characters. Passing leaf tests are not repeated individually; aggregate counts are the normal compact success representation.

## Callback and reload behavior

Unity Test Framework callbacks are not preserved through domain reload. Unity AI Bridge registers its public `IErrorCallbacks` listener from an `[InitializeOnLoad]` type in every loaded domain and stores run state/result data in `SessionState`.

The implementation deliberately uses public Test Framework APIs compatible with the existing Unity 6000.3 package surface (`TestRunnerApi.Execute`, `RegisterTestCallback`, `Filter`, `ExecutionSettings`, `ITestAdaptor`, `ITestResultAdaptor`, `IErrorCallbacks`) rather than private Test Framework runners.

Official Unity documentation defines `TestMode.PlayMode` for programmatic runs and notes that registered callbacks must be re-registered after domain reload.

## Concurrency limitation

The public callback interface used by this slice does not include the Unity run GUID in `RunStarted`/`RunFinished`. The implementation therefore correlates callbacks using the single bridge-owned active journal plus the exact requested assembly/test selection.

Unity AI Bridge refuses to start two owned runs concurrently. However, if an external/manual actor starts an indistinguishable run for the **same exact selection** while a bridge-owned run is active, public callback metadata may be insufficient to distinguish the two. This remains explicit; the bridge does not use private Test Framework internals to guess.

## Verification

### EditMode — Verified 2026-08-24

Windows + Unity **6000.3.21f1**:

- expanded installed-package EditMode suite: **98 Passed / 0 Failed**,
- dedicated official-MCP-client `verify:test-runner` live gate: PASS,
- exact one-test run returned `selectedTestCaseCount=1`, `passCount=1`, `failCount=0`,
- immediate and completed same-id replays preserved one stable Unity `runGuid`,
- conflicting same-id selection was rejected,
- final Editor lifecycle state remained stable `edit`.

The previous 97/97 candidate plus first live gate exposed the full-tree `RunStarted().TestCaseCount` mismatch described above; the count definition was corrected and regression-tested before EditMode control was marked Verified.

### PlayMode — candidate gate

Do not mark the PlayMode extension Verified until all of the following pass on Unity 6000.3.21f1:

- expanded ordinary EditMode regression suite: expected **100/100**,
- dedicated PlayMode test assembly is discoverable,
- its one-frame `[UnityTest]` passes when run as PlayMode,
- official-MCP-client `verify:playmode-tests` passes through PlayMode/domain-reload/reconnect and returns exactly one clean terminal pass,
- same-id immediate/completed replay preserves one `runGuid`,
- conflicting same-id PlayMode selection is rejected,
- final native Editor state returns to stable Edit Mode,
- user Enter Play Mode settings remain unchanged.
