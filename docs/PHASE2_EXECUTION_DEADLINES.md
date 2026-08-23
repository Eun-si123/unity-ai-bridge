# Phase 2 — Execution-boundary deadlines

Status: **Implemented on branch; real Unity verification required before claiming Verified.**

## Problem

Bridge commands already carry `deadlineUnixMs`, and Unity rejects a command that is already expired when the WebSocket message is first handled. That receive-time check alone is not enough for mutations: the Editor main thread can be busy after receipt, so a write could otherwise sit in the dispatcher queue until after the caller has timed out and then execute late.

For reads, a late result is inconvenient but does not mutate Unity. For writes and disk persistence, late execution can create an ambiguous outcome and violate the caller's deadline.

## Policy in this slice

`gameObject.create` and `scene.save` now perform a second deadline check **inside the queued main-thread action, immediately before the operation body is allowed to execute**.

If the queued action reaches the main-thread execution boundary after `deadlineUnixMs`:

- the operation body is not called,
- Unity returns `timeout/deadline_exceeded` when the connection is still available,
- no mutation lifecycle record is started by the operation,
- no GameObject is created,
- no scene file is saved.

The existing receive-time deadline check remains in place as an earlier fast rejection.

## Dispatcher contract

`EditorMainThreadDispatcher.InvokeAsync(action, deadlineUnixMs, operation)` wraps a queued action with an execution-time guard. `EditorDispatchDeadlineExceededException` records the operation, deadline, and observed execution-boundary timestamp.

A missing/non-positive deadline keeps the existing no-deadline dispatcher behavior.

## Scope and limits

This slice prevents **not-yet-started** `gameObject.create` and `scene.save` operations from beginning after their command deadline.

It does not cancel a Unity API call that already began before the deadline. If an operation starts before the deadline and the transport result later becomes ambiguous, the existing mutation lifecycle / mutationId reconciliation remains the safety mechanism. General cooperative cancellation of already-running Unity APIs remains future work.

## Verification gate

Before merge:

1. Unity 6000.3.21f1 compiles the package with no new errors.
2. All EditMode reliability tests pass; this branch adds three deterministic deadline-guard tests to the previous 16-test suite (expected total: 19).
3. `Tools -> Unity AI Bridge -> Verify Execution Deadline Safety` reports PASS. The self-test intentionally queues a short blocking action ahead of a deadline-guarded action and verifies the expired action body never runs.
4. Existing `verify:resolver` and `verify:save` paths remain valid after the dispatcher overload is introduced; rerun only if the new C# compile/self-test exposes a regression or if CI/runtime evidence suggests one.
