# Phase 2 Dirty-State Policy

Unity AI Bridge treats operation-specific state recovery and Unity Editor dirty metadata as separate facts.

## Why

A verified rollback can restore the intended native object state while the active scene remains marked dirty. This was reproduced on Windows / Unity 6000.3.21f1 when a rollback probe started with a clean scene and ended with `sceneIsDirty=True` after the temporary object had been removed and native rollback verification passed.

The project must not silently save a scene merely to make the dirty marker disappear.

## Transaction outcome fields

The common mutation outcome reports:

- `sceneWasDirtyBefore`
- `sceneIsDirtyAfter`
- `dirtyStateChanged`
- `rollbackDirtyResidue`

`rollbackDirtyResidue=true` means all of the following are true:

1. the transaction rolled back,
2. the scene was clean before the transaction,
3. the scene is dirty after rollback.

This is deliberately independent from `rollbackVerified`. An operation can have:

```text
rolledBack=true
rollbackVerified=true
rollbackDirtyResidue=true
```

That means the operation-specific native state was recovered, but Unity Editor metadata still reports unsaved scene changes.

## Save rule

No normal mutation may call a scene save operation implicitly as cleanup. Saving is a user-visible state transition and will be implemented, if exposed, as a separate explicit operation with its own preflight, result, verification, and retry semantics.

## Public Unity API boundary

The documented Unity 6 `EditorSceneManager` API exposes methods to mark scenes dirty and to save scenes. The documented surface does not provide a simple public inverse that clears an existing dirty flag without saving. Unity AI Bridge therefore reports dirty residue rather than relying on undocumented/internal APIs or silently saving.
