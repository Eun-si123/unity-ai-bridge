# Phase 2 Explicit Scene Save

This note defines the implemented contract for the first explicit disk-persistence operation. Runtime claims remain governed by `STATUS.md` and the PR verification record.

## Scope

The operation saves only the **currently active scene** to its **existing Unity scene asset path**.

It does not:

- auto-save after ordinary mutations,
- save all project assets,
- perform Save As,
- open an interactive path picker,
- save an unsaved/untitled scene,
- run during Play Mode or compilation,
- pretend that a disk commit is Undoable.

MCP name: `unity_save_active_scene`  
Unity bridge operation: `scene.save`  
Risk class: `destructive`

## Required precondition

The caller must provide all of:

- `expectedScenePath`
- `expectedStateEpoch`
- `expectedStateRevision`

The scene path and state token must come from a recent observation of the scene the caller intends to persist. Unity checks the active scene identity/path and state token immediately before the disk-save path.

This makes the save an explicit commit of an observed state rather than a generic "save whatever Unity has now" command.

## Execution

```text
capability preflight
 -> Unity main-thread dispatch
 -> reject compile / Play Mode
 -> require valid loaded active scene
 -> require existing scene asset path
 -> require exact expected scene path
 -> require current state epoch/revision
 -> begin same-session mutation lifecycle record
 -> if already clean: completed no-op
 -> otherwise EditorSceneManager.SaveScene(existing path)
 -> verify same scene/path
 -> verify scene.isDirty == false
 -> verify scene file exists under project root
 -> advance state revision
 -> mark lifecycle completed
 -> persist operation-specific replay payload
```

## Retry behavior

`mutationId` protects ambiguous retries in the same Editor session.

A completed save can replay without another disk write only while:

- the active scene path still matches the saved result,
- the scene remains clean,
- the current state epoch/revision exactly equal the cached post-save state.

If state changed after the save, the same mutation id fails closed. A new explicit save intent must refresh state and use a new mutation id.

If the save call fails or its post-save state cannot be verified before a terminal completed lifecycle is recorded, the lifecycle intentionally remains non-completed. The same mutation id is not automatically executed again because the disk outcome may be ambiguous.

## Dirty-state relationship

PR #18 established that operation rollback and dirty metadata are separate facts. `scene.save` is the first operation that intentionally persists current scene state and may make the active scene clean. It must never be invoked implicitly merely to hide dirty residue from another mutation.

## Verification plan

Before claiming the slice Verified:

1. Node build/tests and local bridge CI pass.
2. Unity package compiles on Unity 6000.3.21f1.
3. Unity EditMode reliability tests pass, including save precondition/fingerprint tests that perform no disk write.
4. A real MCP-to-Unity dirty scene save returns `saved=true`, `alreadyClean=false`, `wasDirty=true`, `isDirty=false`.
5. Same-id immediate replay returns `replayed=true` without another save.
6. A new save intent using the pre-save stale state token is rejected with `stale_state/state_revision_mismatch`.

For a low-impact real test, use the existing rollback verifier on a clean test scene first. It removes its temporary object but leaves the known dirty-metadata residue, allowing the explicit save verifier to exercise a real disk write without intentionally preserving a test GameObject.
