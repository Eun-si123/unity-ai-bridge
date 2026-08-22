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

With the Unity project still open, refresh dependencies and run the MCP verifier from the repository root:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:mcp-unity
```

The verifier uses the official MCP TypeScript client over stdio. It launches the normal Unity AI Bridge MCP server as a child process, completes the MCP initialize handshake, confirms `unity_get_status` is advertised, waits for the real Unity Editor to connect to the server's local WebSocket bridge, then calls `unity_get_status` through MCP and validates its structured result.

Expected success output includes:

```text
[Unity AI Bridge] MCP handshake PASS; unity_get_status is advertised.
[Unity AI Bridge] MCP unity_get_status PASS:
...
```

Compare the returned Unity version, project name, active scene, Play Mode state, and compilation state with the actual Editor state. PASS requires the real MCP tool result to match live Unity state; a direct `LocalBridgeServer` call alone is insufficient for this gate.

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
