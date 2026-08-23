# Component inspection contract

`component.inspect` is the first Phase 3 Component-domain operation.

It is intentionally **read-only**. Component add/remove/edit will build on this snapshot contract later rather than relying on unrestricted reflection or arbitrary C# execution.

## Request

Risk classification: `read`.

Arguments:

- `gameObjectGlobalObjectId` — required GameObject `GlobalObjectId` target.
- `maxComponents` — optional, default 32, allowed 1..64.
- `maxPropertiesPerComponent` — optional, default 128, allowed 1..256.
- `maxDepth` — optional, default 4, allowed 0..8.

The target must resolve directly to a GameObject. The operation does not silently reinterpret a Component ID as its owner.

## Snapshot boundary

Unity enumerates `GameObject.GetComponents<Component>()` in native order. Missing Script slots are retained as explicit `missingScript=true` entries.

For each real Component, the bridge returns:

- Component index,
- Component `GlobalObjectId`,
- transient `instanceId`,
- runtime type name and assembly-qualified name,
- MonoBehaviour script asset path when available,
- a bounded list of visible serialized properties.

Serialized properties are traversed through Unity `SerializedObject` / `SerializedProperty` and `NextVisible`. The operation does not crawl arbitrary CLR fields or invoke arbitrary properties through reflection.

## Serialized property values

Every returned property includes path, display name, depth, Unity property type, array metadata, child visibility, and a `valueKind`.

The first contract reports bounded summaries for:

- integer/array-size/character/layer-mask values,
- booleans,
- floating-point numbers,
- strings,
- enums,
- object and exposed references,
- Vector2/3/4,
- Quaternion,
- Color,
- Vector2Int/Vector3Int,
- managed-reference type identity.

Unknown leaf property kinds are reported as `unsupported`; structural properties with visible children are reported as `container`. This avoids inventing a lossy generic value representation.

Object references include transient instance/name/type metadata and a `GlobalObjectId` when Unity can provide one. An empty reference ID is not replaced with a guessed identity.

## Bounds and truncation

The result reports:

- native `componentCount`,
- `returnedComponentCount`,
- total `missingScriptCount`,
- `truncatedByComponentLimit`,
- per-component `returnedPropertyCount`,
- per-component `truncatedByPropertyLimit`,
- per-component `truncatedByDepth`.

Callers must not interpret a bounded result as a complete Component/property inventory when a truncation flag is true.

## State token

The result includes a current Editor `stateEpoch` / `stateRevision`, and the embedded GameObject snapshot is aligned to the same token. Future Component mutation tools can require this observation as an optimistic-concurrency precondition.

## MCP surface

The public MCP adapter is `unity_get_components`.

It capability-preflights `component.inspect` and `state.revision.v1` before sending the request to Unity.

## Verification

Automated coverage includes Node bridge routing/input validation and Unity EditMode contract tests for limits and SerializedProperty value conversion.

Real Unity verification uses `npm run verify:components` to:

1. create a temporary GameObject,
2. inspect its native Transform Component,
3. confirm visible Transform serialized properties,
4. re-resolve the returned Transform Component `GlobalObjectId`,
5. confirm its owning GameObject identity,
6. delete the temporary GameObject through the verified GameObject delete path,
7. confirm the temporary object no longer resolves.

Fixtures:

- `fixtures/component-inspect.command.v0.json`
- `fixtures/component-inspect.result.v0.json`
