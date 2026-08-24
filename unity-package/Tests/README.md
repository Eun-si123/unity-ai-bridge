# Unity AI Bridge package tests

The package includes Unity EditMode tests under `Tests/Editor` in the `EunSung.UnityAiBridge.Editor.Tests` test assembly.

Unity's supported package-test model has two requirements:

1. the package must contain a test assembly marked with `optionalUnityReferences: ["TestAssemblies"]`, and
2. non-embedded package dependencies must be listed in the consuming project's top-level `Packages/manifest.json` `testables` array before Unity Test Framework loads those tests.

Unity AI Bridge handles the second step automatically for development-style installs:

- **Local folder / Add package from disk** — automatically adds `com.eunsung.unity-ai-bridge` to `testables`.
- **Local tarball** — automatically adds it.
- **Git URL dependency** — automatically adds it.
- **Embedded package** — no manifest change is needed because Unity treats embedded packages as development packages.
- **Registry install** — not modified automatically; registry consumers are not forced to compile development tests.

The automatic path preserves existing dependencies and existing testable package names, performs no write when the package is already present, and refuses to rewrite a malformed/non-array `testables` value.

Unity Test Framework does not always immediately discover a package after `testables` changes. When the test assembly is still absent, Unity AI Bridge performs one guarded recursive package reimport per Editor session instead of entering an import loop.

## Verified installed-package behavior

On **2026-08-24**, the non-embedded development-install flow was reproduced in Unity **6000.3.21f1**:

- automatic project-manifest `testables` registration: PASS
- guarded package reimport / test-assembly discovery: PASS
- `EunSung.UnityAiBridge.Editor.Tests` visible in EditMode Test Runner: PASS
- then-current suite: **75 Passed / 0 Failed**

Tests introduced after that run are not implicitly Verified merely because they appear in source. `STATUS.md` records the current verified baseline and any later implemented-but-unverified tests/write families.

## Prefab property apply integration test

PR #36 adds an EditMode integration test for the first bounded existing-Prefab asset mutation. The test uses a temporary writable Prefab under `Assets`, creates a real Transform serialized-property override on a linked instance, applies exactly that property, verifies source/instance readback, verifies same-mutation replay, then deletes the temporary asset and proves stale replay fails closed. The temporary scene instance/asset are cleaned in `finally`.

This new test must run successfully in a real Unity Editor before `prefab.property.apply` is marked Verified.

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

If Test Runner still has not refreshed after Package Manager resolution and compilation finish, use the menu fallback/reimport path and inspect the Console for `[Unity AI Bridge]` bootstrap diagnostics.
