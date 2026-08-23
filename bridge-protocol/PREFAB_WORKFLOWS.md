# Prefab Workflows — Phase 3 First Slice

Status: **Implemented on branch; runtime verification required before merge.**

## Purpose

The first Prefab slice adds two bounded operations without exposing arbitrary Editor scripting:

- `prefab.inspect` / `unity_inspect_prefab`
- `prefab.instantiate` / `unity_instantiate_prefab`

This slice deliberately does **not** create or overwrite Prefab Asset files, apply scene-instance overrides back to assets, unpack instances, or provide a generic Prefab mutation escape hatch.

## Prefab inspection

`prefab.inspect` is read-only. It requires one exact project-relative Prefab Asset path under `Assets` or `Packages` and bounded `maxDepth` / `maxNodes` limits.

Unity loads the Prefab Asset through `AssetDatabase`, confirms it is a Prefab Asset, and returns:

- asset GUID,
- exact path,
- `AssetDatabase.GetAssetDependencyHash(path)` observation,
- `PrefabUtility.GetPrefabAssetType`,
- root name,
- bounded preorder hierarchy entries,
- node names/relative paths/depth/sibling/child/active metadata,
- Component type names, including an explicit Missing Script marker,
- truncation metadata.

Inspection does not instantiate the Prefab into a scene and does not modify the asset.

## Two independent write preconditions

`prefab.instantiate` consumes two different forms of optimistic concurrency because scene state and Prefab Asset state are different domains:

1. **Scene precondition** — `expectedStateEpoch` + `expectedStateRevision` from a recent live Unity scene observation.
2. **Prefab Asset precondition** — `expectedPrefabDependencyHash` from a recent inspection of the exact Prefab Asset.

The bridge does not pretend that the scene revision is an asset revision. The Prefab dependency hash is checked immediately before native instantiation and again during semantic verification.

If the Prefab Asset hash changed, the operation fails closed with `stale_state/prefab_asset_changed` and asks the caller to re-inspect the Prefab before retrying.

## Instantiate mutation flow

For a first-time request:

1. validate exact Prefab path, dependency hash, mutation ID, and scene state token,
2. run the common scene mutation preflight,
3. confirm the Prefab Asset still exists and the dependency hash still matches,
4. instantiate through `PrefabUtility.InstantiatePrefab` into the active scene,
5. register the created root hierarchy with Unity Undo,
6. mark the active scene dirty,
7. resolve the new root through `GlobalObjectId`,
8. verify the root belongs to the expected active scene,
9. verify `PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot` points to the requested Prefab Asset,
10. verify `PrefabUtility.GetCorrespondingObjectFromSource` also resolves back to the requested Prefab Asset,
11. complete the common mutation lifecycle and cache the operation-specific replay result.

If semantic verification fails after creation, the common transaction reverts the Undo group. The rollback verifier requires the created root `GlobalObjectId` to be absent afterwards.

## Replay semantics

A completed same-`mutationId` retry must carry the same Prefab path, expected Prefab dependency hash, and original scene state precondition.

Before replaying the cached completion, Unity rechecks:

- the Prefab Asset still has the expected dependency hash,
- the cached scene object still resolves,
- it is still the same GameObject identity,
- its nearest Prefab instance root still links to the same Prefab Asset,
- it remains in the same scene.

If the user Undoes or deletes the instance, or the linkage no longer matches, the same mutation ID fails with `stale_target/mutation_replay_stale`; it does not create another copy automatically.

## Deadline and risk

`prefab.instantiate` uses `risk=write` and the existing execution-boundary deadline guard. A command that expires while queued does not begin its Unity mutation body.

## Verification fixture

The package includes a deterministic minimal fixture:

`Packages/com.eunsung.unity-ai-bridge/Tests/Editor/Fixtures/PrefabWorkflowFixture.prefab`

with GUID `8a7f7a7f8c15476ebf7a50b5c9049f11` and one root Transform. This avoids making runtime verification depend on whatever Prefabs happen to exist in the consuming project.

## Verification gate

Before this slice is marked Verified:

- latest-head GitHub Node Verification must pass,
- latest-head GitHub local bridge regression must pass,
- Unity 6000.3.21f1 must compile the package with no new errors,
- EditMode must report **56 Passed / 0 Failed**,
- `npm.cmd --prefix mcp-server run verify:prefab` must verify:
  - fixture inspection,
  - dependency-hash capture,
  - real linked Prefab instantiation,
  - resolver readback,
  - immediate same-id replay,
  - one Unity Undo removing the instance,
  - stale same-id replay rejection after Undo.
