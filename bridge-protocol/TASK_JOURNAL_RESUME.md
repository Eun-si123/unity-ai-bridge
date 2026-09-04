# Bounded Multi-Step Task Journal / Resume

Status: **Verified for the bounded first-slice scope below** on Unity 6000.3.21f1. Real installed-package EditMode verification reached **135/135 PASS**, and the dedicated live MCP `verify:task-resume` gate passed against `Assets/SampleScene.unity`.

## Purpose

This slice lets Unity AI Bridge record a small immutable multi-step editing plan before any of its step side effects begin, then report whether the exact next reserved mutation is safe to execute after reconnect, response ambiguity, or an intentional pause.

It is a **journal and admission guard**, not a workflow engine. The task API does not automatically execute, retry, reorder, roll back, or invent replacement mutations.

## First-slice scope

The bounded journal supports only existing GameObjects in the saved active Scene and only these already-reviewed common scene mutations:

- `gameObject.update`
- `transform.set`

Limits:

- current Unity Editor session only;
- Unity `SessionState` storage;
- maximum **16** retained tasks;
- maximum **8** ordered steps per task;
- one unique pre-reserved `mutationId` per step.

A full Unity Editor restart is outside the verified durability boundary.

## Task identity and immutable plan

`task.begin` accepts a caller-chosen `taskId` plus the complete ordered task plan.

Every step binds:

- zero-based step index;
- operation;
- unique mutation id;
- canonical existing GameObject GlobalObjectId;
- operation-specific requested values.

The stored task plan has an internal fingerprint. Reusing the same `taskId` with the exact same plan is an idempotent read-like replay. Reusing the same `taskId` with a different plan fails closed.

A task must be journaled before any of its reserved mutation ids have common mutation lifecycle state.

## Read-like task operations

### `task.begin`

Risk: `read`

`task.begin` creates only bridge-local SessionState journal/reservation records. It must not mutate Scene state or advance the Unity state epoch/revision.

Public MCP tool: `unity_begin_task`.

### `task.get`

Risk: `read`

`task.get` reads the retained task, the common lifecycle state of every reserved mutation, and the current Unity state token. It does not execute a step.

Public MCP tool: `unity_get_task_status`.

A missing or evicted task is reported conservatively as `not_found`. The bridge does not reconstruct task authority from caller memory.

## Reservation admission

Reservations are enforced inside the existing common `EditorMutationLifecycle.Begin` path before lifecycle `started` is written and before the Unity side effect begins.

A reserved mutation is admitted only when all of the following remain true:

- operation and mutation id match the immutable task step;
- requested target and operation-specific values match the immutable planned intent;
- every earlier task step has common lifecycle status `completed`;
- no later task step already has lifecycle state;
- current Unity state exactly equals the task creation boundary for step 0, or the prior completed step's recorded finish boundary for later steps.

This is an additional admission constraint around the existing mutation transaction/lifecycle. It is not a second transaction implementation.

## Resume states

`task.get` returns conservative guidance.

### `ready`

`safeToExecuteNextStep=true` only when:

- the first unresolved step is still pending;
- all earlier steps are verified completed in order;
- no later step has started;
- the current Unity state token exactly matches the expected boundary.

The payload exposes the exact next step index, operation, mutation id, and expected boundary state token to use for the next atomic mutation call.

### `waiting_reconciliation`

Returned when the first unresolved reserved mutation has common lifecycle status `started` without a terminal result. The bridge does not blindly retry it. The caller must reconcile native Unity state and the operation-specific replay/status surface first.

### `blocked`

Automatic continuation is refused for conditions including:

- external Unity state drift;
- terminal step failure;
- operation/lifecycle conflict;
- out-of-order lifecycle state.

The task must be reconciled or replanned rather than silently continuing.

### `completed`

Returned only after every reserved step has common lifecycle status `completed` in order.

A later unrelated Unity state change may make the current state differ from the final task boundary, but it does not retroactively erase the fact that all reserved steps completed.

## Relationship to existing mutation recovery

Each task step remains an ordinary atomic Unity AI Bridge mutation with its existing protections:

- optimistic state epoch/revision preconditions;
- common mutation lifecycle;
- operation-specific same-id replay/readback;
- native verification;
- Unity Undo-backed rollback where the operation already supports it;
- ambiguous-delivery reconciliation for reviewed operations.

The task journal composes these existing primitives. It does not replace them.

## JsonUtility wire normalization

Unity's default by-value serialization can materialize missing/null inline nested objects as empty/default objects. The task wire path therefore treats exact default zero-vector objects produced for operation-irrelevant Transform fields as serialization artifacts and normalizes them away before command validation. Non-default unexpected Transform values remain invalid and fail closed.

The Node response boundary performs the corresponding conservative normalization for Unity-produced null artifacts before applying the existing strict task-payload validator. This does not broaden the semantic task contract; it only canonicalizes Unity serialization artifacts at the transport boundary.

## Fail-closed examples

The first slice explicitly rejects before task step side effects begin when:

- step 2 is invoked before step 1 completes;
- a reserved `gameObject.update` mutation id is called with a different name/active value than the task plan;
- a reserved `transform.set` mutation id is called with different transform values;
- unrelated Unity state advances after the last verified task boundary;
- a later reserved mutation somehow already has lifecycle state;
- the task journal/reservation record is missing or inconsistent.

## Intentional non-goals

The first slice does not:

- automatically execute task steps;
- loop until a task completes;
- blindly retry `started` mutations;
- choose a new mutation id after failure;
- reorder or skip steps;
- provide task-level rollback;
- automatically restore checkpoints;
- support `gameObject.create`, delete, component mutations, checkpoint restore, scripts, assets, Prefabs, Play Mode, or Test Runner steps;
- survive a full Unity Editor restart;
- reconstruct evicted/missing task records from caller-supplied values;
- act as a generic planner or arbitrary workflow language.

## Verification evidence

Verified on Windows + Unity **6000.3.21f1** for PR #58:

1. real installed-package EditMode suite: **135/135 PASS**;
2. earlier exact-code GitHub gates passed while the slice was developed, including Node Verification #388 and Phase 1 Local Bridge Verification #409;
3. dedicated live MCP `npm --prefix mcp-server run verify:task-resume`: **PASS** on `Assets/SampleScene.unity`;
4. exact-final-documentation-head GitHub Node / Phase 1 verification must remain green before merge.

The Unity EditMode suite includes direct command coverage plus JsonUtility wire-path regressions. The live verifier proved:

- `task.begin` left the Unity state token unchanged;
- an out-of-order reserved Transform step was rejected before mutation;
- wrong reserved GameObject arguments were rejected before mutation;
- the first `gameObject.update` completed and exposed the exact next boundary;
- the second `transform.set` completed;
- the two-step task reached `completed`;
- unrelated Unity state drift caused a separate task to report blocked resume;
- executing the drifted reserved step was rejected;
- the blocked task target remained unchanged.

Observed live result:

```text
unityVersion: 6000.3.21f1
activeScenePath: Assets/SampleScene.unity
taskBeginReadOnly: true
outOfOrderStepRejectedBeforeMutation: true
wrongArgumentsRejectedBeforeMutation: true
firstStepCompletedAndNextBoundaryExposed: true
secondStepCompleted: true
taskReachedCompletedState: true
externalStateDriftBlockedResume: true
blockedTaskTargetUnchanged: true
```
