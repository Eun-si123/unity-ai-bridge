# State revision semantics

Phase 2 uses a lightweight optimistic-concurrency token for Editor state that a tool observed before a write.

## Token

A token is the pair:

- `stateEpoch` — stable for the current Unity Editor process/session across script-domain reloads, but regenerated after a full Editor restart.
- `stateRevision` — a positive monotonic counter inside that epoch.

The Unity Agent persists both values through domain reload with `SessionState`.

## What advances the revision

The current v1 tracker advances for:

- successful Unity AI Bridge mutation transactions,
- transaction rollback after a failed mutation/verification,
- `EditorApplication.hierarchyChanged`,
- `Undo.undoRedoPerformed`,
- serialized modifications observed by `Undo.postprocessModifications`.

Multiple Unity notifications for one human-visible action may advance the counter more than once. Consumers must only depend on equality/inequality, not on the numerical distance between revisions.

## Read results

Current status, hierarchy snapshots, and object-resolution results expose the state token. Hierarchy/object reads require Agent capability `state.revision.v1` in the current MCP surface.

## Write precondition

`unity_create_game_object` accepts optional `expectedStateEpoch` + `expectedStateRevision`. They must be supplied together.

When supplied, Unity checks them on the main thread inside common mutation preflight before creating an Undo group or mutating scene state. A mismatch fails closed as:

`stale_state/state_revision_mismatch`

The caller should refresh the relevant Unity state and decide whether the intended mutation is still valid. The bridge must not silently replay the intended write against a different observed state.

## Mutation retry interaction

The mutation id remains the idempotency key. A completed mutation replay is checked before applying the old state precondition again, because an ambiguous retry naturally occurs after the original mutation has already advanced the revision. Reusing a mutation id with different state preconditions is a mutation-id conflict.

## Scope / limitation

`state.revision.v1` is an Editor-side change detector, not a cryptographic snapshot hash and not yet a complete observer of every possible third-party script mutation. Bridge-owned writes advance it explicitly; common hierarchy, Undo, and serialized Inspector changes are also observed. Broader asset/import/runtime-state revision domains remain future work.
