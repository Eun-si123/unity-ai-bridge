# Testing Guide

This document defines the minimum repeatable verification path for Unity AI Bridge. It separates automated Node/protocol checks from real Unity Editor verification so implementation is never mistaken for runtime proof.

## 1. Automated Node / protocol verification

Run from the repository root:

```text
npm --prefix mcp-server ci
npm run build
npm test
```

Current automated coverage should verify at minimum:

- bridge protocol version guard,
- local WebSocket server startup on loopback,
- simulated Unity `hello` registration,
- request ID and route propagation for `editor.status`,
- simulated structured result correlation,
- explicit failure when no Unity Editor is connected.

GitHub Actions is the canonical CI environment for this layer.

## 2. Real Unity 6000.3.21f1 compile check

Target editor: Unity 6000.3.21f1.

1. Open a clean Unity project with Unity 6000.3.21f1.
2. Add `unity-package/package.json` using Package Manager -> Add package from disk.
3. Allow script compilation/domain reload to finish.
4. Confirm the Unity Console contains zero compile errors caused by Unity AI Bridge.
5. Record any warnings separately; warnings are not silently promoted to PASS.

PASS requires the package to load and the Editor assembly to compile successfully.

## 3. Real local bridge connection

1. Install Node dependencies from the committed lockfile.
2. Build the MCP/server package.
3. Start the local MCP/server process.
4. Open the Unity project with the Unity AI Bridge package installed.
5. Confirm Unity establishes an outbound connection to `ws://127.0.0.1:5081`.
6. Confirm the server receives a protocol v0 `hello` containing a non-empty `editorId`, current `connectionGeneration`, Unity version, and project name.

PASS requires a real Unity Editor hello, not a simulated WebSocket peer.

## 4. Real `unity_get_status` end-to-end check

With the real Unity Editor connected:

1. Invoke MCP tool `unity_get_status`.
2. Confirm the bridge emits an `editor.status` command with a unique request ID.
3. Confirm Unity executes the status read on the Editor main thread.
4. Compare the returned Unity version, project name, active scene, Play Mode state, and compilation state with the actual Editor state.
5. Repeat after changing the active scene or Play Mode state where practical.

PASS requires the MCP result to match re-read Editor state.

## 5. Reconnect / domain reload check

1. Record the current `editorId` and `connectionGeneration`.
2. Trigger a script/domain reload or restart the Editor.
3. Confirm the old connection closes or becomes unusable.
4. Confirm Unity reconnects automatically.
5. Confirm the new hello contains a new `connectionGeneration`.
6. Confirm a command routed to the stale generation is rejected.
7. Confirm `unity_get_status` works again on the new connection.

## 6. Evidence format

Every real verification entry added to `STATUS.md` should record:

```text
Date:
Revision:
Environment:
Action/command:
Expected:
Observed:
Result: PASS / FAIL / PARTIAL
Notes:
```

Do not mark real Unity behavior Verified from Node simulation alone.
