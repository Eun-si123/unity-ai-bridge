# Play Mode control verification gate

Candidate: PR #46 / `feature/play-mode-control`

Status: **Verified on Windows + Unity 6000.3.21f1**.

This document records the candidate-specific verification gate. `STATUS.md` is authoritative for the merged/verified surface.

## Why this is a separate reliability family

Play Mode is not a normal scene mutation. Entering or exiting can be asynchronous, can reload the scripting domain and/or scene, can temporarily disconnect the local bridge, and can take materially different amounts of time depending on Editor settings, project complexity, disk speed, and CPU speed.

The first slice therefore treats the native lifecycle and reconnection as part of the operation instead of assuming that setting one Boolean proves completion.

## Automated checks

GitHub Actions passed on the verified PR #46 candidate:

```text
Node Verification: PASS
Phase 1 Local Bridge Verification: PASS
```

Node coverage includes:

1. stable `edit -> play` completion without a required reload,
2. the same Editor reconnecting with a new `connectionGeneration`,
3. rejection of transition-state preconditions and malformed mutation IDs before delivery.

## Unity EditMode suite

Verified environment:

```text
Windows
Unity 6000.3.21f1
PR #46 head d3c4ab9260199a6fd973f0ca7d55c36b55de678a
93 Passed
0 Failed
```

The candidate adds four non-transition EditMode tests:

1. stable-mode argument validation,
2. the four-state native classification (`edit`, `entering_play`, `play`, `exiting_play`),
3. Play Mode intent/retry fingerprint stability,
4. safe `edit -> edit` no-op + same-id replay.

The tests intentionally do not enter real Play Mode from inside the normal EditMode suite because doing so would destabilize the test assembly/lifecycle being used to run the suite.

## Live MCP gate

Command:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:play-mode
```

No sentinel asset or manual Play-button action is required.

The official MCP TypeScript client gate passed and proved:

1. `unity_get_status` advertises `editor.playMode.set` and exposes the detailed Play Mode fields,
2. the Editor starts the main gate in stable Edit Mode,
3. `unity_set_play_mode(edit -> play)` reaches stable native Play Mode,
4. same enter mutationId is replay/readback-only and does not request a second transition,
5. a stale `expectedCurrentMode=edit` request while actually in Play Mode is rejected without changing mode,
6. `unity_set_play_mode(play -> edit)` reaches stable native Edit Mode,
7. same exit mutationId is replay/readback-only,
8. the verifier ends in exact stable Edit Mode,
9. the user's Enter Play Mode settings are unchanged,
10. connection-generation changes are reported but are **not required** because lifecycle/reload behavior can differ.

Observed PASS record on 2026-08-24:

```text
unityVersion: 6000.3.21f1
initialMode: edit
finalMode: edit
enterChanged: true
enterReplayReadOnly: true
enterReconciled: true
enterReloadObserved: true
enterInitialConnectionGeneration: 1787569109635
enterFinalConnectionGeneration: 1787569158803
staleExpectedModeRejected: true
staleAttemptLeftPlayModeUnchanged: true
exitChanged: true
exitReplayReadOnly: true
exitReconciled: true
exitReloadObserved: false
exitInitialConnectionGeneration: 1787569158803
exitFinalConnectionGeneration: 1787569158803
enterPlayModeOptionsEnabled: false
disableDomainReload: false
disableSceneReload: false
userEnterPlayModeSettingsPreserved: true
exactFinalEditStateRestored: true
```

`enterReloadObserved=true` and `exitReloadObserved=false` are both valid observations. The contract does not infer success from reconnect behavior; the terminal stable native mode is authoritative.

## Timeout policy

The MCP SDK has its own request timeout. A lifecycle operation must not rely on a short client default while Unity may legitimately be performing scene/domain reload and reconnection.

The verifier explicitly uses a 180-second tool-call window, and the production Play Mode bridge uses the same long bounded default. This follows the Script-replace live finding where a slower machine exceeded the SDK's default 60-second request timeout even though Unity was behaving normally.

A timeout remains a bounded failure, but ambiguous delivery must reconcile using the **same mutationId** rather than issue a new blind Enter/Exit Play Mode request.

## Enter Play Mode settings

The first slice observes, but never changes:

```text
EditorSettings.enterPlayModeOptionsEnabled
EditorSettings.enterPlayModeOptions
```

The MCP/status surface reports the effective flags:

```text
enterPlayModeOptionsEnabled
disableDomainReload
disableSceneReload
```

A reload is therefore an observed outcome, not a required success condition.

## Exit gate

Passed on 2026-08-24:

```text
93 Passed / 0 Failed
verify:play-mode PASS
```

PR #46 may be marked Verified and merged after source-of-truth docs and final CI are green.