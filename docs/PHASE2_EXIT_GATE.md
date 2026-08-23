# Phase 2 Reliability Core — Exit Gate

Date: 2026-08-23  
Target environment: Windows + Unity 6000.3.21f1

This document records why Phase 2 can be considered complete for the write/read surface that actually exists today. It does not claim reliability guarantees for future tool families that have not been implemented yet.

## Exit decision

**Phase 2 — Reliability Core: Verified milestone.**

The current local bridge has demonstrated that normal disconnect/reconnect, compilation/domain reload, stale state, retry/replay, Agent capability skew, failed verification/rollback, explicit save, and pre-execution deadline expiry do not silently duplicate the currently implemented writes or report success without native Unity evidence.

The verified write/destructive operations at this point are:

- `gameObject.create`
- `scene.save`

Future Phase 3 writes must adopt the same reliability contracts before they can be called verified.

## Verified reliability slices

- PR #10 — stable `GlobalObjectId` resolver, native create readback, stale replay rejection.
- PR #11 — Unity Agent version/capability metadata and MCP capability preflight.
- PR #12 — common mutation preflight + Undo transaction grouping.
- PR #13 — forced semantic-verification failure + real Undo rollback probe.
- PR #14 — Editor-session epoch/revision tokens + stale-state rejection before mutation.
- PR #15 — same-session mutation lifecycle ledger surviving real script/domain reload.
- PR #16 — first Unity EditMode reliability suite, 8/8.
- PR #17 — structured `changed/verified/rolledBack/rollbackVerified` contract, native rollback verification, 12/12 EditMode.
- PR #18 — explicit dirty-state outcome reporting; clean -> rollback -> dirty residue is surfaced instead of hidden.
- PR #19 — explicit active-scene save with exact scene/state preconditions, native save verification, same-id replay, stale-token rejection, 16/16 EditMode.
- PR #20 — execution-boundary deadline guard for write/destructive actions, real queued-expiry self-test, 19/19 EditMode.

## Important observed behaviors

### Native write verification and rollback

`gameObject.create` is not reported successful merely because Unity API calls returned. The created target is re-resolved from current native Unity state before the completed mutation result is cached.

A forced verifier failure proved that the common transaction can revert its Undo group and then run an operation-specific rollback verifier. The structured outcome distinguishes:

- `changed`
- `verified`
- `rolledBack`
- `rollbackVerified`

A rollback-verification failure has a dedicated failure path instead of being reported as success.

### Dirty-state behavior

A verified object rollback can still leave a previously clean scene dirty. This was reproduced from:

- `sceneWasDirtyBefore=false`
- object rollback verified
- `sceneIsDirtyAfter=true`
- `rollbackDirtyResidue=true`

This is treated as an explicit state outcome, not hidden. Ordinary mutations never silently save.

`scene.save` is a separate destructive operation and was verified to:

- require the expected active scene path,
- require the exact observed state epoch/revision,
- save only an already-named scene to its existing `.unity` path,
- refuse interactive Save As behavior,
- verify `scene.isDirty == false` after a successful save,
- verify the scene file exists under the project root,
- replay the same completed `mutationId` without writing twice,
- reject a new save using the pre-save stale revision.

### Retry and ambiguous delivery

Current write operations expose/use a `mutationId` so a caller can retry the same logical mutation without inventing a new write identity.

For `gameObject.create`, identical completed replay returns the cached operation result only after the native target is re-resolved and revalidated. If the object was later Undone/deleted/moved/renamed so the completed target no longer matches, replay fails closed instead of creating a replacement.

For `scene.save`, completed same-id replay is accepted only while the active scene/path/clean state and cached post-save state token still match. A changed Unity state fails closed.

If a lifecycle record is left at `started` across a same-session domain reload without a terminal operation-specific result, retrying that same mutationId fails closed rather than blindly executing again.

### Deadline behavior

The bridge has both an early receive-time deadline check and a write/destructive execution-boundary check.

PR #20's real Unity self-test queued a 75 ms blocker ahead of a 10 ms-deadline guarded action. The guarded action reached the execution boundary after the deadline and reported:

- `expiredBeforeExecution=true`
- `actionExecuted=false`

This prevents a not-yet-started queued write from beginning after the caller's command deadline has elapsed.

This does **not** interrupt a Unity API call that already started before the deadline. Once an operation begins, ambiguous outcome handling relies on mutation lifecycle + mutationId reconciliation rather than unsafe mid-API interruption.

## Phase 2 exit gate mapping

| Exit concern | Evidence at exit |
|---|---|
| Main-thread Unity API execution | Current bridge handlers dispatch through the Unity Editor main-thread queue. |
| Stable target identity | `GlobalObjectId` resolver verified; transient `InstanceID` is not used as sole durable identity. |
| Stale state | Editor-session epoch/revision preconditions reject stale writes before mutation. |
| Unsupported Agent/tool skew | Non-status tools preflight Agent capability metadata and fail closed on missing capabilities. |
| Undo/recovery | Common transaction owns Undo grouping; verified rollback + rollback verification exists for Undo-capable mutation paths. |
| Dirty state | Dirty state is explicitly reported; rollback dirty residue is not misreported as full scene restoration. |
| Explicit persistence | `scene.save` is explicit, destructive, state/path gated, and natively verified. |
| Duplicate delivery | `mutationId` replay protection is verified for current writes. |
| Domain reload | Connection generation refresh + same-session mutation lifecycle survival verified. |
| Queued timeout | Write/destructive execution boundary rejects expired work before its body runs. |
| Test coverage | Reliability EditMode suite reached 19 Passed / 0 Failed on Unity 6000.3.21f1. |

## Explicit non-goals / remaining unknowns

These are **not** being relabeled as verified merely to close Phase 2:

- `SessionState` mutation lifecycle does not provide full Unity Editor restart persistence.
- Exact `GlobalObjectId` behavior for every unsaved/new-scene/unusual object case is not exhaustively characterized.
- A successful Undo rollback does not currently clear a dirty flag that Unity leaves behind on a previously clean scene.
- A Unity API call already in progress is not forcibly cancelled when its deadline later expires.
- Rich component/property/asset snapshots and semantic verifiers do not exist yet because those Phase 3 write families do not exist yet.
- Multi-editor routing, remote authentication, pairing, and remote gateway behavior belong to later phases.
- Unity compatibility beyond the current 6000.3.21f1 verification target remains unverified.

## Rule for Phase 3

Phase 3 does not get to bypass the reliability work completed here.

Every new write family should, where applicable, provide:

1. durable target resolution,
2. stale-state preconditions,
3. explicit risk classification,
4. main-thread execution,
5. Undo grouping for reversible Editor mutations,
6. native readback/semantic verification,
7. rollback + rollback verification when verification fails,
8. mutation identity/replay behavior,
9. execution-boundary deadline enforcement,
10. explicit dirty/save behavior,
11. automated and real Unity evidence before being marked Verified.
