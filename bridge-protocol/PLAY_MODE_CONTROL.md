# Play Mode control

This document defines the first bounded Play Mode lifecycle mutation in bridge protocol v0.

## Operation

```text
editor.playMode.set
```

The public MCP tool is:

```text
unity_set_play_mode
```

## Scope

The first slice controls only the stable Editor lifecycle states:

- `edit`
- `play`

It intentionally does **not** change the user's Enter Play Mode settings, pause/unpause the Editor, save scenes, or mutate runtime objects.

`editor.status` additionally reports transition states:

- `entering_play`
- `exiting_play`

These states are observations, not valid `targetMode` or `expectedCurrentMode` values.

## Why `isPlaying` alone is insufficient

Unity changes Play Mode asynchronously. During exit, native state can still report `isPlaying=true` while the Editor is already leaving Play Mode. The bridge therefore exposes:

```text
isPlaying
isPaused
isPlayingOrWillChangePlaymode
playModeState
```

and classifies the combined native state as:

```text
false + false -> edit
false + true  -> entering_play
true  + true  -> play
true  + false -> exiting_play
```

## Command

Representative command:

```json
{
  "protocolVersion": "0",
  "requestId": "...",
  "operation": "editor.playMode.set",
  "arguments": {
    "targetMode": "play",
    "expectedCurrentMode": "edit",
    "mutationId": "..."
  },
  "risk": "write",
  "route": {
    "editorId": "...",
    "connectionGeneration": 1
  },
  "deadlineUnixMs": 4102444800000
}
```

### Preconditions

- `targetMode` must be exactly `edit` or `play`.
- `expectedCurrentMode` must be exactly `edit` or `play` and match current native stable state.
- a new transition is rejected while Unity is compiling.
- a new transition is rejected while native state is `entering_play` or `exiting_play`.
- `mutationId` follows the common bounded retry-identity syntax.

## Mutation identity and ambiguous delivery

Play Mode changes can cause a domain reload depending on the user's Editor settings. The Unity Agent writes a SessionState journal **before** requesting `EditorApplication.EnterPlaymode()` or `EditorApplication.ExitPlaymode()`.

A repeated delivery with the same mutationId never blindly calls Enter/Exit again. It instead reconciles the journal with native Play Mode state:

- target stable state reached -> mark/replay completed;
- native transition toward target -> return replay observation without another transition request;
- still at the original stable state after an ambiguous started intent -> fail closed as incomplete;
- unexpected third state -> fail closed as stale replay.

This SessionState journal is same-Editor-session state; it does not claim durability across a full Editor process restart.

## MCP completion semantics

The Unity bridge result confirms only the main-thread transition request/replay stage. The MCP bridge then waits for the **same Editor identity** to reach the requested stable state.

A changed `connectionGeneration` is accepted and reported as `reloadObserved=true`, but is not required. Users may disable Domain Reload through Unity's Enter Play Mode settings.

The final MCP result includes:

```text
finalMode
finalIsPlaying
finalIsPaused
finalIsPlayingOrWillChangePlaymode
enterPlayModeOptionsEnabled
disableDomainReload
disableSceneReload
reloadObserved
initialConnectionGeneration
finalConnectionGeneration
```

## Persistence / Undo / dirty state

Play Mode control is an operational Editor write, not a source/asset write:

- risk: `write`
- changedTargets: empty
- dirtyState: `unchanged`
- Unity Undo: unavailable
- automatic scene save: none

The tool does not promise that user/runtime scripts cannot alter scene/runtime state while Play Mode is running; it only states that the Play Mode command itself does not persist project files or invoke scene save.

## Timeout policy

Entering/exiting Play Mode may include asset processing, script-domain reload, scene reload, and bridge reconnection. Completion time varies substantially with machine and project size.

The MCP bridge therefore treats a temporary disconnect as a normal reconciliation condition and uses a long bounded completion window. A timeout is an ambiguous lifecycle outcome and must not be converted into a fresh blind transition request with a new mutationId.

## Deferred slices

Separate future contracts may add:

- pause / resume,
- single-frame step,
- explicit Enter Play Mode settings mutation,
- runtime hierarchy/state inspection policy,
- Test Runner orchestration.

They are not implied by this first Play Mode control slice.
