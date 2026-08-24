# Test discovery contract

This document defines the bounded read-only Unity Test Framework discovery surface for bridge protocol v0.

Verified operation:

- `test.list` — retrieve the assemblies or exact leaf tests Unity Test Framework actually discovers for EditMode or PlayMode.

MCP adapter: `unity_list_tests`.

## Purpose

The verified Test Runner start tools require an explicit assembly and optionally exact full test names. AI clients should not have to infer those selectors from source files or stale documentation.

The intended workflow is:

```text
unity_list_tests(testMode, no assembly)
 -> exact discovered assembly names
 -> unity_list_tests(testMode, exact assembly)
 -> exact discovered leaf fullName values
 -> unity_start_editmode_tests / unity_start_playmode_tests
```

Unity Test Framework remains the source of truth for discovery.

## Risk and preconditions

Risk: `read`.

The operation:

- never starts a test run,
- never enters Play Mode,
- never mutates scenes/assets or claims project dirty state,
- requires Unity not to be compiling,
- requires stable Edit Mode while the Test Framework tree is retrieved.

The implementation uses the public instance `TestRunnerApi.RetrieveTestList(TestMode, callback)` API because it remains available on the Test Framework 1.4 public surface targeted by the existing Test Runner integration. Retrieval is asynchronous; the bridge schedules it on Unity's main thread and awaits the callback without blocking the Editor update loop.

## Arguments

- `testMode` — required exact `edit` or `play`.
- `assemblyName` — optional exact discovered assembly name without `.dll`, at most 256 characters.
  - omitted: assembly scope,
  - supplied: leaf-test scope within that exact assembly.
- `nameContains` — optional case-insensitive substring filter, at most 256 characters.
  - assembly scope: filters assembly names,
  - test scope: filters test `fullName`.
- `offset` — zero-based result offset, 0..2147483647.
- `maxResults` — page size 1..200; MCP default 100.

Whitespace-only optional strings and `.dll` assembly suffixes are rejected rather than silently normalized.

## Deterministic result shape

Common fields:

- `testMode`
- `scope` (`assemblies` or `tests`)
- `assemblyName`
- `nameContains`
- `totalMatches`
- `offset`
- `maxResults`
- `returnedCount`
- `nextOffset`
- `truncated`
- `assemblies`
- `tests`

Invariant:

```text
nextOffset = offset + returnedCount
truncated = nextOffset < totalMatches
```

Matches are sorted with ordinal name ordering before paging. If `offset` is already beyond `totalMatches`, the result page is empty, `nextOffset` remains equal to the requested offset, and `truncated=false`; the cursor never rewinds.

### Assembly scope

Each assembly entry contains:

- exact normalized assembly `name` (trailing `.dll` removed when Unity exposes it),
- `testCaseCount` from the discovered Test Framework assembly node.

`tests` is empty.

### Test scope

Each leaf test contains:

- `name`
- exact `fullName`
- bounded informational `uniqueName`
- bounded informational `parentFullName`
- `runState`
- bounded sorted `categories`
- `selectableByBridge`

`fullName` is deliberately not truncated because it is the exact selector consumed by the Test Runner start tools. `selectableByBridge` is true only when the exact full name fits the current 512-character start-tool selector bound.

`name`, `uniqueName`, and `parentFullName` are informational and may be truncated to 1,024 characters. Categories are limited to 32 values, each at most 256 characters.

## First-slice limits

This operation intentionally does not expose:

- regex/category/group selection syntax,
- source-file inference,
- arbitrary NUnit reflection objects,
- test arguments as arbitrary serialized objects,
- automatic test execution,
- discovery during active Play Mode,
- standalone Player discovery.

Those remain separate future contracts.

## Verification evidence

Verified on **2026-08-24** on Windows + Unity **6000.3.21f1** using PR #49 product head `736103567e863eb27f1035c431f6dc6aec023bb7`.

Required gates passed:

```text
Installed-package EditMode regression: 105/105
npm --prefix mcp-server run verify:test-discovery: PASS
```

The live gate proved:

- native EditMode assembly discovery exposed `EunSung.UnityAiBridge.Editor.Tests` with `testCaseCount=105`,
- five `TestDiscoveryControlTests` exact leaf names were discovered in deterministic order,
- exact selectors were directly consumable by the current Test Runner start contract,
- one-result paging and past-end cursor semantics matched the documented invariant,
- native PlayMode assembly discovery exposed `EunSung.UnityAiBridge.PlayMode.Tests` with one test,
- exact PlayMode selector matched `UnityAiBridge.PlayMode.Tests.PlayModeVerifierTests.RunsOneFrameInsidePlayMode`,
- an unknown exact assembly failed closed,
- final Editor state remained stable Edit Mode,
- scene state epoch/revision remained unchanged,
- `projectMutated=false`.

See [`../docs/TEST_DISCOVERY_TESTING.md`](../docs/TEST_DISCOVERY_TESTING.md) and [`../STATUS.md`](../STATUS.md) for the recorded runtime evidence.