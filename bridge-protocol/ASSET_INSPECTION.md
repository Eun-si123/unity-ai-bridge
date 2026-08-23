# Asset Search / Inspection — Phase 3 Read-Only Slice

Status: **Implemented on branch; runtime verification required before merge.**

## Purpose

This slice introduces a bounded read-only Unity asset discovery surface that future prefab, material, texture, script, and importer workflows can build on without bypassing Unity's AssetDatabase.

Matching MCP tools:

- `unity_search_assets`
- `unity_inspect_asset`

Matching Unity bridge operations:

- `asset.search`
- `asset.inspect`

Both operations use `risk=read`.

## Source of truth

The Unity Editor Agent uses public Unity AssetDatabase/AssetImporter APIs rather than recursively scanning the project filesystem itself.

The first slice uses:

- `AssetDatabase.FindAssets`
- `AssetDatabase.GUIDToAssetPath`
- `AssetDatabase.AssetPathToGUID`
- `AssetDatabase.GetMainAssetTypeAtPath`
- `AssetDatabase.LoadMainAssetAtPath`
- `AssetImporter.GetAtPath`
- `AssetDatabase.GetLabels`
- `AssetDatabase.GetDependencies(path, false)`
- `AssetDatabase.GetAssetDependencyHash`

This keeps the returned identity/type/importer/dependency information aligned with Unity's imported project view.

## Asset paths

Accepted project-relative paths must:

- be under `Assets` or `Packages`,
- use `/` separators,
- be at most 512 characters,
- not be absolute paths,
- not contain parent traversal (`..`).

`asset.search` additionally requires every supplied search folder to be a valid Unity AssetDatabase folder.

`asset.inspect` requires an exact asset file path. Folder paths fail closed with `stale_target/asset_unavailable` rather than being silently treated as recursive inspections.

## `asset.search`

Input:

- `filter` — Unity AssetDatabase search filter, maximum 256 characters; empty is allowed,
- `searchInFolders` — 1..16 valid project folders; MCP defaults to `["Assets"]`,
- `maxResults` — 1..200; MCP defaults to 50.

Unity resolves matching GUIDs through `FindAssets`, converts them back to asset paths, captures summary metadata, sorts the summaries by path using ordinal ordering, and returns only the requested bounded prefix.

Output includes:

- original filter and folder scope,
- total resolved matches,
- returned count and explicit truncation flag,
- GUID,
- asset path/name/extension,
- Unity main asset type name,
- whether the returned path is a folder.

The MCP default deliberately searches `Assets` rather than silently searching every package as well. Callers can explicitly include `Packages` or narrower package folders when needed.

## `asset.inspect`

Input:

- exact asset file `path`,
- `maxDependencies` — 0..256; MCP defaults to 64.

The command requires both a non-empty Unity GUID and a loadable main asset. It returns:

- GUID and exact path,
- name/extension,
- main asset type,
- current main asset InstanceID/name,
- importer type when Unity exposes an importer for that path,
- sorted labels,
- Unity asset dependency hash,
- total direct dependency count,
- bounded direct dependency GUID/path/type entries and truncation metadata.

`maxDependencies=0` suppresses dependency entries while retaining the direct dependency total.

## Identity and change observation

GUID remains the durable Unity asset identity returned by this slice. Path remains the current AssetDatabase location and is used for exact inspection.

`dependencyHash` is a Unity-produced observation of the imported asset/dependency state. It is not a replacement GUID and is not currently accepted as a write precondition because this slice does not mutate assets. A future asset-write slice can evaluate it as part of an optimistic-concurrency contract without pretending the scene `stateRevision` describes imported asset state.

`mainAssetInstanceId` is transient process-local metadata and is never treated as the durable asset identity.

## Deliberate non-goals

This slice does not:

- mutate importer settings,
- create/delete/move/rename assets,
- modify labels,
- modify asset contents,
- recursively dump arbitrary serialized asset properties,
- return file bytes or source text,
- expose arbitrary C# or filesystem execution.

Prefab/script/material-specific semantic inspection remains a later Phase 3 concern.

## Verification gate

Before this slice is called Verified:

1. Node Verification must pass,
2. Phase 1 Local Bridge Verification must pass,
3. Unity 6000.3.21f1 must compile the package without new C# errors,
4. the EditMode suite must report **50 Passed / 0 Failed**,
5. `npm.cmd --prefix mcp-server run verify:assets` must:
   - discover a real Scene asset under `Assets`,
   - verify deterministic path ordering,
   - inspect the same GUID/path,
   - return a non-empty main type and dependency hash,
   - repeat inspection with stable GUID/hash in the absence of asset mutation,
   - honor `maxDependencies=0`,
   - reject folder inspection with `stale_target/asset_unavailable`.

The live verifier is read-only and does not require Undo or cleanup.
