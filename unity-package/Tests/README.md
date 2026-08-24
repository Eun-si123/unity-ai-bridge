# Unity AI Bridge package tests

The package includes Unity EditMode tests under `Tests/Editor` in the `EunSung.UnityAiBridge.Editor.Tests` test assembly.

Unity's supported package-test model has two requirements:

1. the package must contain a test assembly marked with `optionalUnityReferences: ["TestAssemblies"]`, and
2. non-embedded package dependencies must be listed in the consuming project's top-level `Packages/manifest.json` `testables` array before Unity Test Framework loads those tests.

Unity AI Bridge now handles the second step automatically for development-style installs:

- **Local folder / Add package from disk** — automatically adds `com.eunsung.unity-ai-bridge` to `testables`.
- **Local tarball** — automatically adds it.
- **Git URL dependency** — automatically adds it.
- **Embedded package** — no manifest change is needed because Unity treats embedded packages as development packages.
- **Registry install** — not modified automatically; registry consumers are not forced to compile development tests.

The automatic path only updates the `testables` entry. It preserves existing dependencies and existing testable package names, performs no write when the package is already present, and refuses to rewrite a malformed/non-array `testables` value.

After the manifest changes, Package Manager resolves again and Unity recompiles scripts. The EditMode tests should then appear in Test Runner under `EunSung.UnityAiBridge.Editor.Tests`.

## Manual fallback

If automatic enabling fails because the project manifest is read-only or otherwise cannot be updated, use:

`Tools > Unity AI Bridge > Enable Package Tests`

or add the package manually while preserving all existing entries:

```json
{
  "dependencies": {
    "com.eunsung.unity-ai-bridge": "file:<path-to-unity-package>"
  },
  "testables": [
    "com.eunsung.unity-ai-bridge"
  ]
}
```

If Test Runner still has not refreshed after Package Manager resolution and compilation finish, reimport the package or restart the Editor.
