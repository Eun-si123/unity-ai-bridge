# Mutation Status v0

`mutation.status` exposes a bounded read-only view of the existing Unity Editor-side common mutation lifecycle journal.

This first slice deliberately does **not** create a second transaction system. It reads `EditorMutationLifecycle`, whose records are stored in Unity `SessionState` for mutations executed through `EditorMutationTransaction`.

## Request

- operation: `mutation.status`
- risk: `read`
- arguments:
  - `mutationId` — required, 1..128 characters, `[A-Za-z0-9._:-]+`

The operation never executes, replays, rolls back, or otherwise mutates the requested operation.

## Scope and durability

The result always reports:

- `journalKind=editor_mutation_lifecycle_v1`
- `sessionScope=current_editor_session`
- `coverage=editor_mutation_transaction_v1`

The current journal survives script-domain reload through `SessionState`, but it is **not** a full Editor-restart durable log. Script replacement, persistent Prefab/asset operations, Play Mode, and Test Runner currently have operation-specific lifecycle/replay journals that are not unified into this first status surface.

Therefore `found=false` / `status=not_found` means only that this common current-session journal has no record. It is not proof that Unity never observed a side effect, and it must never be treated as permission for a blind retry.

## Result

A result contains:

- requested `mutationId`
- whether a common lifecycle record was `found`
- journal/scope/coverage identifiers
- recorded operation name when found
- lifecycle status
- terminal flag
- started/finished Unix timestamps and state epoch/revision observations
- failure kind when recorded
- `intentIdentityRecorded` without exposing the internal intent fingerprint itself
- `safeToBlindRetry`, which is always `false` in this slice
- `recommendedAction`

Current lifecycle statuses are:

- `not_found`
- `started`
- `completed`
- `failed_rolled_back`
- `failed_no_mutation`
- `rollback_failed`
- `rollback_verification_failed`

Recommended actions intentionally remain conservative:

- `not_found` -> `reobserve_native_state`
- `started` -> `reconcile_native_state_before_retry`
- `completed` -> `operation_specific_same_id_replay_or_reobserve`
- clean failure/rollback terminal states -> `reobserve_then_new_mutation_id_if_needed`
- rollback failure or rollback-verification failure -> `manual_reconciliation_required`

## Security / privacy boundary

`EditorMutationLifecycle` stores an internal `intentFingerprint` used to bind a mutation id to immutable intent. Current fingerprints may contain target/value/precondition material, so `mutation.status` does not expose that string. It exposes only `intentIdentityRecorded`.

## Non-goals of the first slice

- no generic Undo endpoint
- no arbitrary historical rollback
- no automatic retry
- no cross-Editor or full-restart transaction persistence
- no claim that all operation-specific journals are unified
- no inference that an absent record means an operation never ran

The next reconciliation work may unify additional operation families only when their persistence and native-readback semantics can be represented without weakening their existing fail-closed contracts.
