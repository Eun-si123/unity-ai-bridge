# Common Mutation Delivery Reconciliation

Status: **Verified first slice** on 2026-09-03.

This document records the bounded MCP-to-Unity reconciliation behavior introduced after the common mutation lifecycle status surface.

## Scope

The first verified allowlist is intentionally small:

- `gameObject.create`
- `transform.set`

Other mutation families continue to use their previous behavior until they are reviewed and admitted explicitly.

## Recovery flow

```text
mutation request with mutationId
 -> normal delivery succeeds: return normally
 -> delivery becomes ambiguous by timeout/disconnect
 -> require same Unity editorId
 -> read mutation.status(mutationId)
 -> started: bounded polling only
 -> completed: resend exact same operation + exact same intent + same mutationId
 -> operation-specific Unity same-id replay/readback returns the result
 -> any unsafe/unknown state: fail closed
```

`completed` is not by itself treated as a recovered result. Recovery still depends on the operation-specific same-id replay path verifying current native Unity state.

## Fail-closed rules

The bridge does **not** automatically execute a new mutation when:

- `mutation.status` returns `not_found`;
- the mutation ID belongs to another operation;
- lifecycle status is `failed_no_mutation`, `failed_rolled_back`, `rollback_failed`, or `rollback_verification_failed`;
- a different Unity Editor connects;
- the operation-specific replay state is missing or stale;
- the bounded recovery window expires.

No new mutation ID is generated during reconciliation. No generic Unity Undo or rollback is added by this layer.

## Automated Node coverage

The Node suite covers:

- timeout ambiguity -> `completed` -> same-ID result replay;
- disconnect -> same Editor reconnect -> same-ID result replay using the new connection generation;
- `not_found` -> fail closed with no second mutation delivery;
- non-allowlisted `gameObject.update` -> no automatic reconciliation.

## Real Unity verification

Environment:

```text
Windows
Unity 6000.3.21f1
active scene: Assets/SampleScene.unity
PR #53 head: 5979bc394abf59f35268467cf696d33eec1ce387
Node Verification #369: PASS
Phase 1 Local Bridge Verification #390: PASS
```

Dedicated gate:

```text
npm --prefix mcp-server run verify:mutation-reconciliation
```

Observed result:

```text
Common mutation reconciliation verification PASS
injectedFault: drop_first_success_result_after_unity_execution
createResultDropped: true
createRecoveredViaSameIdReplay: true
createLifecycleStatus: completed
transformResultDropped: true
transformRecoveredViaSameIdReplay: true
transformLifecycleStatus: completed
finalPositionVerified: true
temporaryObjectRemaining: false
```

The verifier uses a local WebSocket fault proxy. Unity executes the real mutation and sends its real success result; the proxy deliberately discards the first success result for the selected operation. The bridge must therefore recover from a genuinely ambiguous response-loss condition rather than from a mocked Unity result.

An initial verifier attempt exposed a proxy-only WebSocket framing bug: forwarding Node `ws` `RawData` directly could turn JSON text into a binary frame on the Unity-facing leg, causing `editor.status` to time out before fault injection began. The final verifier explicitly forwards JSON as text frames; the real-Unity gate then passed.

## Boundary

This verification demonstrates current-process/current-session response-loss reconciliation for the two allowlisted common transaction operations. It does not prove full Unity Editor process-restart durability, generic arbitrary retry safety, or reconciliation for mutation families not yet admitted to the allowlist.
