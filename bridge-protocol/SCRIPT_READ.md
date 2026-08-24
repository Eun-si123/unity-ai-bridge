# Script Read — Bridge Protocol v0

`script.read` is the first Script-domain operation in Unity AI Bridge. It is intentionally **read-only** and establishes the exact file-content observation that a later reload-safe Script write workflow can use as a compare-and-swap precondition.

## Intent

Read one exact Unity C# script asset without mutating the project, compiling scripts, refreshing assets, or changing scene state.

The operation is separate from generic `asset.inspect` because an AI code workflow needs bounded source content plus a raw file-content identity, not only imported asset metadata.

## Command

```json
{
  "protocolVersion": "0",
  "requestId": "script-read-1",
  "operation": "script.read",
  "arguments": {
    "path": "Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs",
    "offset": 0,
    "maxChars": 20000
  },
  "risk": "read",
  "route": {
    "editorId": "...",
    "connectionGeneration": 1
  },
  "deadlineUnixMs": 4102444800000
}
```

### Arguments

- `path` — exact project-relative `.cs` Unity asset path under `Assets/` or `Packages/`, using `/` separators. Empty, `.`, `..`, backslash, non-script, and outside-project asset paths are rejected.
- `offset` — zero-based UTF-16 code-unit offset into the decoded source. Default `0`; range `0..2147483647`. An offset beyond the source length or one that splits a surrogate pair is rejected.
- `maxChars` — maximum UTF-16 code units to return. Default `20000`; range `1..100000`. A returned chunk will be shortened by one code unit when necessary to avoid intentionally splitting a surrogate pair.

## Unity asset/path resolution

The Agent first resolves `path` through Unity `AssetDatabase`:

1. `AssetPathToGUID(path)` must return a GUID,
2. `GUIDToAssetPath(guid)` becomes the canonical project-relative path,
3. `LoadAssetAtPath<MonoScript>` must resolve the canonical `.cs` asset,
4. `Assets/` files resolve relative to the Unity project root,
5. `Packages/` files resolve through `PackageInfo.FindForAssetPath` and the package `resolvedPath` rather than guessing PackageCache layout.

The current read slice supports source files up to **4 MiB** and strict UTF-8 text only. UTF-8 BOM is accepted and reported but not included in decoded `content`.

## Result

A successful `result` contains:

- `guid` — Unity asset GUID,
- `path` — canonical project-relative path,
- `sourceKind` — `Assets` or `Packages`,
- `packageName` — empty for Assets; exact package name for Packages,
- `dependencyHash` — Unity `AssetDatabase.GetAssetDependencyHash` observation,
- `contentSha256` — lowercase SHA-256 of the **raw source-file bytes**, including a UTF-8 BOM when one exists,
- `encoding` — currently `utf-8`,
- `hasUtf8Bom`,
- `byteLength` — raw file byte count,
- `utf16CharCount` — decoded .NET/JavaScript string code-unit count,
- `lineCount`,
- `offset`, `maxChars`,
- `returnedCharCount`,
- `nextOffset`,
- `truncated`,
- `content`.

Paging invariant:

```text
nextOffset == offset + returnedCharCount
truncated == (nextOffset < utf16CharCount)
```

Callers should continue with the returned `nextOffset`; they should not calculate a byte offset from the UTF-16 character position.

## Content identity and future writes

`dependencyHash` and `contentSha256` serve different purposes:

- `dependencyHash` is Unity imported-state metadata,
- `contentSha256` is the exact raw file-content identity.

The planned first Script write workflow should use the current `contentSha256` as its exact compare-and-swap precondition so an AI cannot silently overwrite source that changed after it was read.

`script.read` itself has no `mutationId`, scene `stateRevision`, Undo, or dirty-state semantics because it performs no mutation.

## Errors

Representative errors:

- `validation/risk_mismatch` — risk is not `read`,
- `validation/invalid_arguments` — invalid path/paging arguments,
- `stale_target/script_unavailable` — the Unity script asset or source file disappeared/is unavailable,
- `unsupported/script_encoding` — source is not strict UTF-8,
- `unsupported/script_too_large` — raw source exceeds the 4 MiB first-slice limit,
- `unity_api/script_read_failed` — unexpected Unity/filesystem failure.

## Excluded from this slice

- source writes/replacement,
- package-source mutation,
- arbitrary filesystem paths,
- binary/non-UTF-8 source decoding,
- AST/symbol editing,
- Roslyn rewrite semantics,
- automatic compilation triggering,
- domain-reload reconciliation.

Those are separate contracts. In particular, Script write must explicitly handle AssetDatabase import, compilation, assembly/domain reload, mutation replay, and post-reload verification rather than assuming scene-write transaction behavior applies unchanged.
