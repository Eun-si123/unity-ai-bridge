# Phase 2 Verification Core

This note defines the current bounded verification contract for Unity-side mutations. It records implementation intent; runtime claims remain governed by `STATUS.md`.

## Transaction outcome

A mutation transaction tracks four independent facts:

- `changed` — the operation registered Undo state and therefore may have changed Unity state.
- `verified` — native post-write verification confirmed the requested result.
- `rolledBack` — Unity Undo was invoked successfully after a failed execution/verification path.
- `rollbackVerified` — a native post-rollback verifier confirmed the expected recovered state.

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

A successful verified write should report `changed=true`, `verified=true`, `rolledBack=false`, `rollbackVerified=false`.

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
