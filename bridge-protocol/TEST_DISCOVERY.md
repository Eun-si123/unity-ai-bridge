# Test discovery contract

This document defines the bounded read-only Unity Test Framework discovery surface for bridge protocol v0.

Implemented operation:

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

Matches are sorted with ordinal name ordering before paging.

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

## Verification gate

Do not mark Test discovery Verified until:

- automated Node/local bridge checks pass,
- the expanded installed-package EditMode suite passes on real Unity 6000.3.21f1,
- the dedicated `verify:test-discovery` MCP gate proves EditMode and PlayMode assembly discovery, exact leaf names, deterministic paging, and selector compatibility with the already-verified Test Runner controls.
