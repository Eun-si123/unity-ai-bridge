# Bridge Action History and Safe Last-Action Undo

Status: **Verified first slice** on 2026-09-04 against PR #55 head lineage, Windows, Unity 6000.3.21f1.

## Scope

The first slice records only verified, changed, Unity-Undo-backed scene mutations that use the common `EditorMutationTransaction` path and have been explicitly reviewed:

- `gameObject.create`
- `gameObject.update`
- `gameObject.delete`
- `transform.set`
- `component.add`
- `component.remove`
- `component.property.set`

The journal is SessionState-backed and therefore scoped to the current Unity Editor process/session. Script writes, persistent Prefab/asset writes, Play Mode, and Test Runner operations remain outside this journal.

## `action.history`

Risk: `read`

Arguments:

```json
{
  "maxResults": 10
}
```

`maxResults` is bounded to 1..32. Results are newest first.

The payload identifies the journal/scope/coverage, current Unity state token and Undo group metadata, and bounded action records. Only the newest action can ever report `safeToUndoNow=true`; all older entries are observational history only.

A latest action is advertised as safe only when all current native evidence still matches the recorded completion state:

- the action has not already been undone through this surface;
- Unity is not compiling;
- Unity is not in or transitioning into/out of Play Mode;
- current state epoch/revision equals the action's recorded post-state token;
- active scene path is unchanged;
- `Undo.GetCurrentGroup()` equals the recorded Undo group;
- `Undo.GetCurrentGroupName()` equals the recorded Undo group name.

This safety flag is deliberately conservative. Benign Editor interaction may advance Unity's Undo group and make a previously bridge-owned action unavailable even when Edit > Undo would still happen to target it.

## `action.undoLast`

Risk: `write`

Arguments:

```json
{
  "mutationId": "exact-latest-bridge-mutation-id",
  "expectedStateEpoch": "epoch-from-fresh-history-observation",
  "expectedStateRevision": 123
}
```

The request fails closed unless the supplied mutation ID is exactly the newest bridge action and the fresh state token/current native Undo evidence still passes the same safety checks.

When admitted, Unity AI Bridge calls `Undo.PerformUndo()` once. It then requires `Undo.undoRedoEvent` to report:

- `isRedo == false`;
- the exact recorded Undo group;
- the exact recorded Undo name;
- a changed Unity state token after the Undo.

If post-Undo verification does not match, the bridge reports a verification failure and requires native re-observation. It does not blindly issue Redo or a second Undo.

## Verification evidence

Environment:

```text
Windows
Unity 6000.3.21f1
active scene: Assets/SampleScene.unity
```

Installed-package EditMode suite:

```text
119 Passed
0 Failed
```

Dedicated live gate:

```text
npm --prefix mcp-server run verify:action-undo
```

Observed result:

```text
[Unity AI Bridge] Bridge action history + safe last-action Undo verification PASS
firstCreateUndoGroup: 36
firstCreateUndoVerifiedByNativeAbsence: true
firstCreateCannotUndoTwice: true
transformUndoGroup: 42
olderCreateUndoRejected: true
rejectedOlderUndoLeftTransformUnchanged: true
transformRestoredExactly: true
latestUndoneActionNotReexposedAsSafe: true
temporaryObjectRemaining: false
```

This live verification proves that:

1. a newly created GameObject can be undone only while that exact bridge action is still the safe latest Unity Undo action, and native resolution confirms the object is gone;
2. the same action is not exposed as safely undoable twice;
3. after a second create followed by `transform.set`, the older create mutation ID is rejected rather than walking backward through history;
4. the rejected older-action request leaves the newer Transform unchanged;
5. the actual latest Transform Undo restores native local position, Euler rotation, and scale to the pre-mutation values;
6. the undone latest record is not re-exposed as safe;
7. verifier cleanup leaves no temporary object.

The initial live-verifier build exposed a verifier-only TypeScript strict-nullability defect around direct `actions[0]` dereferences. The verifier was changed to require a latest entry explicitly before dereference; no Unity C# production behavior changed for that fix, and the live gate then passed.

## Intentional non-goals

This is **not**:

- arbitrary `undo(mutationId)`;
- rollback of any historical bridge mutation;
- a loop that walks backward through old bridge actions;
- full Unity Editor restart durability;
- a replacement for operation-specific mutation verification or rollback;
- a promise that every Unity Undo-able action is represented in the journal.

After one action is undone through this surface, that same record is marked undone and is not exposed as safe again. The first slice also does not automatically promote an older action to a new safe-Undo target; a new verified bridge mutation must occur before another action can become the latest candidate.

## History recording failure

History recording occurs only after the mutation itself has already completed native verification and its common lifecycle has been marked completed. Journal persistence is therefore best-effort and must not retroactively turn a successful mutation into a late rollback. If recording fails, safe last-action Undo simply remains unavailable for that action.
