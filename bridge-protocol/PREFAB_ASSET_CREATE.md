# Prefab Asset Creation

`prefab.asset.create` is the first Prefab authoring operation. It creates one **new** `.prefab` asset from a plain GameObject in the current active scene.

This slice deliberately uses Unity `PrefabUtility.SaveAsPrefabAsset`, not `SaveAsPrefabAssetAndConnect`: the source scene GameObject is not converted into or connected as a Prefab instance by this operation.

## Risk and persistence

- Bridge risk: `destructive`.
- The operation writes a new project asset to disk.
- Unity Undo is **not** advertised for the asset creation.
- A successful creation does not intentionally mutate scene state, so the returned scene state revision is not required to advance merely because an asset was written.

## Arguments

- `sourceGlobalObjectId` — exact `GlobalObjectId` of a live GameObject in the loaded active scene.
- `destinationPath` — exact new path under `Assets/`, ending in `.prefab`.
- `mutationId` — same-session retry identity.
- `expectedStateEpoch` + `expectedStateRevision` — fresh scene precondition covering the source GameObject observation.

The destination parent folder must already exist in `AssetDatabase`. `Packages` destinations, parent traversal, backslashes, non-Prefab extensions, and occupied destinations are rejected. The operation never overwrites an existing asset.

The first authoring slice rejects a source that is already part of a Prefab instance. Variant authoring and Apply/Revert workflows are separate future contracts.

## Native write and verification

Unity performs the create with `PrefabUtility.SaveAsPrefabAsset` on the Editor main thread. After Unity reports success, the Agent verifies all of the following before reporting success:

1. the source GameObject still resolves through its `GlobalObjectId`,
2. the source has not been implicitly converted into a Prefab instance,
3. the destination loads as a real Prefab Asset,
4. the new asset has a non-empty GUID,
5. the new asset has a non-empty `GetAssetDependencyHash` observation,
6. the Prefab root name matches the source GameObject name.

If semantic verification fails after a confirmed new asset creation, the Agent deletes only that newly-created destination through `AssetDatabase.DeleteAsset` and verifies that no GUID/main asset remains. Failure to prove cleanup is returned explicitly.

## Retry semantics

A completed same-`mutationId` replay does not write again. It succeeds only while the destination still has the cached:

- asset path,
- GUID,
- dependency hash,
- Prefab root name.

If the asset was deleted or changed after completion, the same mutation id fails closed with `stale_target/mutation_replay_stale` and does not recreate or overwrite anything. A genuinely new creation intent requires a new mutation id and an absent destination.

`SessionState` provides same-Editor-session retry protection; this is not a durable transaction log across a full Editor restart.

## Result

The operation-specific result reports:

- mutation/replay flags,
- source `GlobalObjectId` and source name,
- destination path,
- new Prefab GUID,
- observed dependency hash,
- Prefab asset type/root name,
- supplied scene precondition and current scene state token.

`changedTargets` is empty because the write creates a project asset rather than a scene object. `dirtyState` is `unchanged`; `undo.available` is `false`.
