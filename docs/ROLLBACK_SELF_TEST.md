# Transaction Rollback Self-Test

This is a developer-only Unity Editor verification helper for the Phase 2 common mutation transaction core. It does not add a public MCP tool.

## Run

1. Use Unity 6000.3.21f1 with the branch containing `EditorMutationRollbackSelfTest.cs` loaded and compiled.
2. In Unity choose `Tools -> Unity AI Bridge -> Verify Transaction Rollback`.
3. Read the Unity Console.

PASS output begins with:

```text
[Unity AI Bridge] Transaction rollback self-test PASS:
```

The probe intentionally creates one temporary GameObject inside `EditorMutationTransaction`, registers it with Unity Undo, deliberately returns `false` from native verification, lets the transaction core revert the current Undo group, then verifies both:

- the captured `GlobalObjectId` no longer resolves (`found=false`), and
- no hierarchy object with the unique probe name remains (`hierarchyMatches=0`).

The log also reports scene dirty state before and after the probe. Scene dirty-state restoration is observed separately from object rollback because Unity's public `EditorSceneManager` API exposes `MarkSceneDirty` but not a general-purpose public "restore previous dirty flag" operation. Do not claim dirty-state restoration merely because object rollback passed.
