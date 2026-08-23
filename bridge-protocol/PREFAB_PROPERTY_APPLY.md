# Prefab Property Override Apply

`prefab.property.apply` is the first bounded Prefab override persistence operation in Unity AI Bridge.

It deliberately does **not** expose Unity's broad "Apply All" behavior. The caller supplies one exact live Component identity and one exact visible serialized property path, and Unity applies only that property override to one exact Regular Prefab Asset.

## Inputs

- `componentGlobalObjectId` — exact live Component `GlobalObjectId` on a Prefab instance in the active scene.
- `propertyPath` — exact visible serialized property path on that Component.
- `prefabPath` — exact writable `Assets/.../*.prefab` target.
- `expectedPrefabDependencyHash` — exact dependency hash from a recent Prefab inspection.
- `mutationId` — same-session retry identity.
- `expectedStateEpoch` + `expectedStateRevision` — fresh active-scene state precondition.

## First-slice bounds

The first slice accepts only:

- Regular Prefab Assets under `Assets`,
- non-Transform Components,
- direct Component sources whose corresponding source object belongs to the requested Prefab Asset,
- visible, editable properties currently marked as Prefab overrides,
- Boolean, Integer, Float, String, or Vector3 properties,
- non-array properties other than `m_Script`.

Model Prefabs, immutable/package assets, variants/nested source redirection, Transform/RectTransform fields, arrays/containers, `m_Script`, and other serialized property kinds are rejected rather than guessed or broadened automatically.

## Native operation

Unity executes `PrefabUtility.ApplyPropertyOverride(instanceProperty, prefabPath, InteractionMode.AutomatedAction)` on the Editor main thread.

The operation is classified `risk=destructive` because it persists a Prefab Asset disk change. The bridge does not advertise Unity Undo or a rollback guarantee for this asset write.

The active-scene state token and Prefab dependency hash protect separate state domains:

- the scene token protects the live instance/property observation,
- the dependency hash protects the Prefab Asset that will receive the property.

## Verification

After apply, the Agent synchronously reimports the exact Prefab Asset and verifies:

1. the Prefab GUID is unchanged,
2. the Prefab dependency hash changed from the expected pre-write hash,
3. the live instance property is no longer marked as a Prefab override,
4. the corresponding source Prefab property and live instance property contain equal serialized data,
5. the Component remains linked to the same requested Regular Prefab Asset.

A success result includes the old expected hash, post-write hash, override-before/after flags, source/instance comparison result, and post-write scene state token.

## Retry semantics

A completed `mutationId` may replay only while the exact completed state still exists:

- the same Component/property remains linked to the same Prefab Asset,
- the Prefab GUID remains the same,
- the current dependency hash equals the cached post-write hash,
- the instance property is not a new override,
- source and instance serialized data still match.

If the user later creates another override, changes/deletes the asset, or changes the linkage, the same mutation id fails with `stale_target/mutation_replay_stale`. It does not apply a later override automatically.

This is same-session retry protection. It is not a full Editor-restart transaction log.
