# Unity AI Bridge package tests

The package includes Unity EditMode tests under `Tests/Editor`.

When `com.eunsung.unity-ai-bridge` is installed as a non-embedded dependency (for example with **Package Manager -> Add package from disk**), Unity does not load the package's tests into Test Runner by default. Enable them in the consuming Unity project's `Packages/manifest.json` by adding the package name to the top-level `testables` array:

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

Preserve the project's existing dependencies and any existing `testables` entries; only add `com.eunsung.unity-ai-bridge` if it is not already present.

After saving the manifest, wait for Package Manager/script compilation to finish. If Test Runner still shows no package tests, reimport the Unity AI Bridge package or restart the Editor. The expected EditMode assembly is `EunSung.UnityAiBridge.Editor.Tests`.

Embedded packages are treated as development packages by Unity and do not require this explicit `testables` entry.
