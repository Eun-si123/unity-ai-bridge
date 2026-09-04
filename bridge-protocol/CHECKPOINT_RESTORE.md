# Bounded GameObject Checkpoint / Restore

Status: implementation candidate. Do not treat this surface as Verified until the required real-Unity gates are recorded in `STATUS.md`.

## Purpose

This slice provides a deliberately small recovery primitive for one existing GameObject in one saved active Scene. It is intended to let an agent capture a known-good local object state before a bounded sequence of edits and restore that state later when the exact target identity is still safe to reuse.

It is **not** a Scene backup system and it is **not** arbitrary historical rollback.

## Current-session storage

Checkpoints are stored in Unity `SessionState` and therefore belong only to the current Unity Editor process/session. The first slice retains at most **16** checkpoint records, newest first. When the bound is exceeded, the oldest retained checkpoint is evicted.

A missing or evicted checkpoint fails closed. The bridge does not reconstruct it from caller-supplied values.

## Captured state

`checkpoint.capture` accepts exactly one GameObject `GlobalObjectId` in the current saved active Scene and records:

- canonical GameObject `GlobalObjectId`;
- saved Scene path;
- direct parent GameObject `GlobalObjectId`, or empty for a root object;
- `name`;
- `activeSelf`;
- local position;
- local rotation;
- local scale;
- the Unity state epoch/revision observed at capture time.

Children, Components, component serialized properties, assets, Prefab assets, sibling order, Scene settings, and unrelated objects are outside this checkpoint.

Capture is read-like with respect to Unity Scene state. It writes only the bounded bridge-local SessionState record and must not advance the Unity scene state token.

## Deterministic checkpoint identity

The bridge generates the checkpoint id. Callers cannot choose it.

The format is:

```text
cp-<lowercase SHA-256>
```

The hash binds the bounded snapshot identity/content plus captured Unity state epoch/revision. Re-capturing the same object while the relevant Unity state token and captured values are unchanged yields the same checkpoint id.

`capturedUnixMs` is observation metadata and is not the source of checkpoint identity.

## `checkpoint.get`

Risk: `read`

Reads one exact retained checkpoint by id. It does not read caller-provided replacement values and it does not modify Unity Scene state.

## `checkpoint.restore`

Risk: `write`

Arguments bind:

- exact retained `checkpointId`;
- `mutationId`;
- fresh `expectedStateEpoch`;
- fresh `expectedStateRevision`.

Before applying checkpoint values, Unity AI Bridge requires all of the following:

- the checkpoint is still retained in the current Editor session;
- the target GameObject still resolves through the checkpoint's canonical `GlobalObjectId`;
- the target still belongs to the current active loaded Scene;
- the active Scene still has the exact saved Scene path captured in the checkpoint;
- the target still has the exact same direct parent identity captured in the checkpoint;
- the supplied state epoch/revision is current;
- Unity is not compiling.

A reparented target is rejected because applying old local Transform values under a different parent would have different semantics.

A deleted target is rejected. **Restore never recreates a deleted GameObject.**

If admitted, restore changes only:

- GameObject name;
- GameObject `activeSelf`;
- local position;
- local rotation;
- local scale.

The change executes through one `EditorMutationTransaction` with one Unity Undo group, native verification, rollback, and rollback verification.

Scene Prefab instances use the existing explicit `PrefabUtility.RecordPrefabInstancePropertyModifications` behavior for these bounded fields.

## Replay behavior

A successful `checkpoint.restore` stores an operation-specific replay result for the current Editor session.

Same mutation id + same checkpoint/state intent is **readback-only**:

- if native state still matches the completed checkpoint state, the bridge returns `replayed=true`;
- if native state no longer matches, replay fails stale;
- the bridge never blindly reapplies a completed restore merely because the same mutation id was retried.

Same mutation id + different checkpoint or state precondition fails with a mutation-id conflict.

## Relationship to safe last-action Undo

`checkpoint.restore` uses Unity Undo internally for transaction rollback and returns ordinary Undo metadata for the newly executed restore. However, it is **not currently admitted to the verified bridge action-history / safe-last-action-Undo allowlist**.

That allowlist remains intentionally limited to the previously reviewed seven common scene-edit families until checkpoint restore is separately reviewed for that surface.

## Intentional non-goals

The first slice does not:

- snapshot or restore an entire Scene;
- recreate deleted GameObjects;
- reparent objects;
- restore sibling order;
- restore children or descendants;
- add/remove/restore Components;
- restore arbitrary serialized properties;
- restore Prefab or other persistent asset contents;
- survive a full Unity Editor restart;
- provide arbitrary historical rollback;
- accept caller-authored checkpoint payloads as restore authority.

## Required verification before `Verified`

At minimum:

1. full installed-package EditMode suite on Unity 6000.3.21f1;
2. Node build/tests;
3. dedicated live MCP `verify:checkpoint-restore` gate proving:
   - capture is read-only for the Unity state token;
   - unchanged recapture produces the same checkpoint id;
   - checkpoint get is read-only and exact;
   - bounded name/active/local Transform mutation can be restored;
   - same-id restore replay is read-only;
   - deleting the target makes later restore fail closed;
   - checkpoint restore does not recreate the deleted target;
   - verifier cleanup leaves no temporary object.
