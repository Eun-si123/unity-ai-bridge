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

## 3. Real local bridge + `editor.status` verification helper

With the Unity project open and the package loaded, run from the repository root:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:unity
```

The helper builds the TypeScript server, listens on `ws://127.0.0.1:5081`, waits up to 30 seconds for the real Unity Editor's protocol v0 `hello`, prints the received editor identity/version/project data, sends a real `editor.status` command, and prints the structured result.

Expected success output includes:

```text
[Unity AI Bridge] Verification bridge listening on ws://127.0.0.1:5081
[Unity AI Bridge] Real Unity hello received:
...
[Unity AI Bridge] editor.status PASS:
...
```

Compare the printed status against the open Editor:

- Unity version,
- project name,
- active scene,
- Play Mode state,
- compilation state.

This helper verifies the real Unity WebSocket/bridge path. It does not by itself prove the MCP stdio tool transport.

## 4. Real MCP `unity_get_status` end-to-end check

Start the normal MCP/server process:

```text
npm --prefix mcp-server run build
npm --prefix mcp-server start
```

The process should report:

```text
[Unity AI Bridge] Local bridge listening on ws://127.0.0.1:5081
```

With a real Unity Editor connected, invoke MCP tool `unity_get_status` from an MCP client and:

1. confirm the bridge emits an `editor.status` command with a unique request ID,
2. confirm Unity executes the status read on the Editor main thread,
3. compare returned Unity version, project name, active scene, Play Mode state, and compilation state with the actual Editor state,
4. repeat after changing the active scene or Play Mode state where practical.

PASS requires the MCP result to match re-read Editor state.

## 5. Reconnect / domain reload check

1. Record the current `editorId` and `connectionGeneration` from a successful real hello.
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
