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
- bounded `scene.hierarchy` request/result propagation,
- hierarchy input-limit validation,
- `scene.create_game_object` routes as `risk: write`,
- GameObject create name/idempotency-key validation before mutation routing,
- explicit failure when no Unity Editor is connected,
- explicit stale-generation error propagation.

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

## 5. Reconnect / domain reload / stale-generation check

With Unity still open, run:

```text
npm --prefix mcp-server run verify:reconnect
```

The verifier first records the live `editorId` and `connectionGeneration` and confirms `editor.status`. When it prints that it is waiting for a new connection generation, trigger a Unity script/domain reload. There is no dedicated "Domain Reload" button required for this test; creating or editing a C# script so Unity recompiles scripts is sufficient.

PASS requires all of the following:

1. the same `editorId` reconnects,
2. the new hello has a different `connectionGeneration`,
3. an `editor.status` command deliberately routed to the old generation is rejected with `routing/stale_connection`,
4. a normal `editor.status` succeeds on the new generation.

Expected success output includes:

```text
[Unity AI Bridge] Reconnect detected:
...
[Unity AI Bridge] Stale generation rejection PASS: routing/stale_connection: ...
[Unity AI Bridge] Post-reconnect editor.status PASS:
...
[Unity AI Bridge] Reconnect + stale-generation verification PASS.
```

## 6. Real MCP `unity_get_hierarchy` end-to-end check

Use the current hierarchy branch/package source and keep the Unity Editor open on a scene whose Hierarchy window you can compare against. First confirm Unity has finished compiling the branch with no Unity AI Bridge compile errors, then run from the repository root:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:hierarchy
```

The verifier launches the normal MCP server over stdio, confirms `unity_get_hierarchy` is advertised, waits for the real Unity Editor connection, calls the tool with `maxDepth=8` and `maxNodes=200`, and validates the structured hierarchy result.

Expected success output includes:

```text
[Unity AI Bridge] MCP handshake PASS; unity_get_hierarchy is advertised.
[Unity AI Bridge] MCP unity_get_hierarchy PASS:
...
```

The exact counts and node list depend on the live scene. For PASS, compare the returned scene name/path, root GameObject names, parent/child ordering, and active states with the actual Unity Hierarchy. Every returned node should contain a `globalObjectId` string and a transient `instanceId`. `hierarchyPath` and `instanceId` are informational/session-scoped aids and must not be treated as sole durable identity.

If the scene exceeds the requested bounds, `truncatedByDepth` or `truncatedByNodes` may legitimately be true. That is not a failure by itself.

## 7. Real MCP `unity_create_game_object` write/idempotency check

Use a disposable or otherwise safe test scene. The verifier intentionally creates one unsaved root GameObject and leaves it in the scene so the user can inspect it and exercise Unity Undo afterward.

First pull the current create branch and wait for Unity compilation to finish with zero Unity AI Bridge compile errors. Then run:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:create
```

The verifier:

1. launches the normal MCP server over stdio,
2. confirms `unity_create_game_object` and `unity_get_hierarchy` are advertised,
3. generates one unique name and one unique `idempotencyKey`,
4. calls `unity_create_game_object`, requiring `created=true`, `deduplicated=false`, `sceneDirty=true`, and the expected Undo group name,
5. repeats the same tool call with the same key and requires `created=false`, `deduplicated=true`, and the same `GlobalObjectId`,
6. calls `unity_get_hierarchy` and requires exactly one node with that `GlobalObjectId`.

Expected ending:

```text
[Unity AI Bridge] First create PASS:
...
[Unity AI Bridge] Same-key deduplication PASS.
[Unity AI Bridge] Hierarchy readback PASS; exactly one created object exists.
[Unity AI Bridge] Create + idempotency verification PASS.
[Unity AI Bridge] The test object is intentionally left unsaved; use Unity Undo once to remove it.
```

After the command completes, verify in the Unity Hierarchy that exactly one test GameObject exists. Use **Edit -> Undo** (or the normal Undo shortcut) once and confirm that the created object disappears. Do not save the test scene merely to complete this verification.

Current idempotency storage uses Unity `SessionState`, so same-key protection survives script/domain reloads within the same Editor session but is not yet a durable cross-Editor-restart ledger. That stronger guarantee belongs to later reliability work and must not be inferred from this test.

## 8. Evidence format

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
