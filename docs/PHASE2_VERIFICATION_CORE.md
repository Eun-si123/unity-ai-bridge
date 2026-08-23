# Phase 2 Verification Core

This note defines the current bounded verification contract for Unity-side mutations. Runtime claims remain governed by `STATUS.md`.

## Transaction outcome

A mutation transaction tracks four independent facts:

- `changed` — the operation registered Undo state and therefore may have changed Unity state.
- `verified` — native post-write verification confirmed the requested result.
- `rolledBack` — Unity Undo rollback completed after a failed execution/verification path.
- `rollbackVerified` — an operation-specific native post-rollback verifier confirmed the expected recovered state.

These flags are intentionally separate. In particular, `rolledBack=true` does not imply `rollbackVerified=true`.

## Success path

```text
preflight
 -> mutate
 -> native verify
 -> verified=true
 -> collapse Undo group
 -> advance state revision
 -> lifecycle completed
```

A successful verified write reports `changed=true`, `verified=true`, `rolledBack=false`, `rollbackVerified=false`.

## Failed verification path

```text
mutate
 -> native verify fails
 -> Undo revert
 -> rolledBack=true
 -> native rollback verify
    -> PASS: rollbackVerified=true, rethrow original verification failure
    -> FAIL: dedicated rollback-verification failure
```

The original mutation is never converted into success merely because rollback succeeded.

## Lifecycle states

The same-session mutation ledger distinguishes:

- `started`
- `completed`
- `failed_rolled_back`
- `failed_no_mutation`
- `rollback_failed`
- `rollback_verification_failed`

A terminal lifecycle record without an operation-specific replay payload remains fail-closed for the same mutation ID.

## Current scope

The bounded `gameObject.create` path is the first production consumer of native rollback verification. Broader component/property/asset mutation families must adopt an operation-appropriate post-write verifier and rollback verifier rather than relying on generic success assumptions.

## Verification evidence — 2026-08-23

Environment: Windows / Unity 6000.3.21f1.

Automated GitHub checks:

- Node Verification run `32616243285`: PASS.
- Phase 1 Local Bridge Verification run `32616243298`: PASS.

Unity EditMode:

- **12 Passed / 0 Failed**.

Real rollback probe:

```text
forcedVerificationFailure=true
changed=true
verified=false
rolledBack=true
rollbackVerifierCalled=true
rollbackVerified=true
rollbackTargetFound=false
hierarchyMatches=0
sceneWasDirty=False
sceneIsDirty=True
```

Real `gameObject.create` regression via `verify:resolver`:

- first create returned `replayed=false`,
- resolver returned `found=true` for the same canonical GlobalObjectId/name/scene/GameObject type,
- immediate identical retry returned `replayed=true`,
- one Unity Undo caused resolver to return `found=false`,
- later same-mutation retry failed closed as `stale_target/mutation_replay_stale`,
- hierarchy readback reported zero matching replacement objects.

## Important dirty-state boundary

The rollback probe started from a clean scene but the scene remained dirty after verified object rollback (`sceneWasDirty=False`, `sceneIsDirty=True`). Therefore `rollbackVerified=true` currently means the operation-specific native state was restored; it does not imply that Editor dirty metadata was restored.

Current documented Unity 6 `EditorSceneManager` APIs expose `MarkSceneDirty` and scene save operations, but the documented API surface does not provide a simple public inverse that clears an existing scene dirty flag without saving. The project must not silently save merely to clear this flag. Dirty-state/save policy is therefore a separate Reliability Core concern.
