# Prefab Property Override Apply

`prefab.property.apply` persistently applies exactly one existing serialized-property override from a scene Prefab instance to one explicitly selected Prefab Asset.

The MCP tool name is `unity_apply_prefab_property_override`.

This is deliberately narrower than Unity's broad Prefab apply surface. The first slice does **not** expose Apply All, object/component-wide apply, added/removed object/component apply, unpacking, or automatic nested-Prefab target selection.

## Why the asset path is explicit

Unity can have more than one valid apply target for a property on a nested Prefab instance. The caller must therefore supply the exact `prefabPath`; the Agent verifies that the scene Component has a corresponding source Component in that exact asset before applying anything.

## Risk and persistence

- Bridge risk: `destructive`.
- The operation modifies an existing `.prefab` asset on disk.
- Unity Undo is **not** advertised for this operation.
- `dirtyState` is reported as `unknown` in the first slice because applying an override can also change instance override metadata and the operation's primary contract is the persistent asset write.
- If execution or verification becomes ambiguous, the same `mutationId` is not blindly executed again.

## Arguments

- `componentGlobalObjectId` — exact `GlobalObjectId` of the scene Component that owns the existing override.
- `propertyPath` — exact visible `SerializedProperty.propertyPath` to apply.
- `prefabPath` — exact writable Prefab Asset under `Assets/`.
- `expectedPrefabDependencyHash` — exact dependency hash observed from a recent inspection of that asset.
- `mutationId` — same-session retry identity; the MCP bridge may generate one when omitted.
- `expectedStateEpoch` + `expectedStateRevision` — fresh active-scene state precondition for the instance observation.

## First-slice restrictions

The operation rejects:

- non-Component targets,
- Components outside the loaded active scene,
- Components that are not part of a Prefab instance,
- a `prefabPath` that is not an explicit corresponding source for the Component,
- paths outside `Assets/` or non-`.prefab` assets,
- Model Prefabs,
- `m_Script`,
- array properties, array elements, and `Array.size`,
- properties that are not visible serialized properties,
- properties that are not currently Prefab overrides,
- stale scene state or stale Prefab dependency hashes.

Arrays are excluded because Unity documents that applying one array element can widen to the entire array when the corresponding source array is shorter. The first contract refuses that implicit widening.

## Native write and verification

The Agent executes Unity `PrefabUtility.ApplyPropertyOverride(instanceProperty, prefabPath, InteractionMode.AutomatedAction)` on the Editor main thread.

Before the write it verifies:

1. the scene state token is current,
2. the selected Prefab Asset still has `expectedPrefabDependencyHash`,
3. the Component is a live Prefab instance Component,
4. the selected asset contains the corresponding source Component,
5. the exact visible property exists and is an active Prefab override,
6. the property is within the bounded first-slice restrictions.

After the write it re-imports the exact Prefab Asset synchronously and re-resolves fresh serialized state. Success is reported only when:

1. the instance property no longer reports `prefabOverride`,
2. `SerializedProperty.DataEquals(instanceProperty, sourceProperty)` proves the instance and selected source property contain the same serialized data,
3. the Prefab GUID and post-write dependency hash are available.

This operation does not claim a generic automatic rollback after an ambiguous persistent asset mutation. If Unity applies the asset write but verification cannot prove the outcome, the mutation lifecycle remains non-retriable for the same `mutationId`; clients must re-inspect native Unity state before deciding what to do next.

## Retry semantics

A completed same-`mutationId` replay never applies again. It succeeds only when:

- the Prefab path still resolves to the same GUID,
- its current dependency hash still equals the cached post-apply hash,
- the scene Component still corresponds to the explicitly selected Prefab Asset,
- the instance property is no longer an override,
- the instance/source properties still compare equal by `SerializedProperty.DataEquals`.

If any of those facts changed, replay fails closed instead of repeating the destructive write.

## Result

The operation-specific result reports:

- mutation/replay/applied flags,
- canonical Component `GlobalObjectId` and Component type,
- property path,
- Prefab path/GUID,
- expected/before/after dependency hashes,
- supplied scene precondition,
- current scene state token after verification.
