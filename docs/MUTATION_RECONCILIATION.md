# Common Mutation Delivery Reconciliation

Status: **Verified common scene-mutation coverage** on 2026-09-04.

This document records the bounded MCP-to-Unity reconciliation behavior built on the common mutation lifecycle status surface.

## Verified scope

The verified common scene-edit allowlist is:

- `gameObject.create`
- `gameObject.update`
- `gameObject.delete`
- `transform.set`
- `component.add`
- `component.property.set`
- `component.remove`

These operations all use `EditorMutationTransaction` plus operation-specific same-`mutationId` SessionState replay/readback. They were reviewed individually before admission to automatic ambiguous-delivery reconciliation.

Other mutation families remain outside this common allowlist unless they are reviewed and admitted explicitly. Script, persistent Prefab/asset, Play Mode, and Test Runner operations retain their operation-specific journals/reconciliation models.

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

`completed` is not by itself treated as a recovered result. Recovery still depends on the operation-specific same-ID replay path verifying current native Unity state.

## Fail-closed rules

The bridge does **not** automatically execute a new mutation when:

- `mutation.status` returns `not_found`;
- the mutation ID belongs to another operation;
- lifecycle status is `failed_no_mutation`, `failed_rolled_back`, `rollback_failed`, or `rollback_verification_failed`;
- a different Unity Editor connects;
- the operation-specific replay state is missing or stale;
- the bounded recovery window expires.

No new mutation ID is generated during reconciliation. No generic Unity Undo or rollback is added by this layer. A missing status record never proves that no side effect happened.

## Automated Node coverage

The Node suite covers the common reconciliation mechanism and admission boundary, including:

- timeout ambiguity -> `completed` -> same-ID result replay;
- disconnect -> same Editor reconnect -> same-ID result replay using the new connection generation;
- `not_found` -> fail closed with no blind second mutation;
- exact seven-operation allowlist admission.

PR #54 automated evidence:

```text
Node Verification #371: PASS
Phase 1 Local Bridge Verification #392: PASS
```

## Real Unity verification

Environment:

```text
Windows
Unity 6000.3.21f1
active scene: Assets/SampleScene.unity
PR #54 code head: 7a447563d4a32cf1721045c619279c118a73bd8a
```

Dedicated gate:

```text
npm --prefix mcp-server run verify:mutation-reconciliation
```

The verifier performs one chained real-Unity workflow:

```text
gameObject.create
 -> gameObject.update
 -> transform.set
 -> component.add (UnityEngine.BoxCollider)
 -> component.property.set (m_IsTrigger=true)
 -> component.remove
 -> gameObject.delete
```

For **every** operation, the local WebSocket fault proxy waits for Unity to execute the mutation and emit its success result, then deliberately discards that first success result. The bridge therefore has to recover from an actually ambiguous response-loss condition through:

```text
mutation.status -> completed -> exact same mutationId replay/readback
```

Observed result on 2026-09-04:

```text
Common mutation reconciliation verification PASS

createResultDropped: true
updateResultDropped: true
transformResultDropped: true
addResultDropped: true
propertyResultDropped: true
removeResultDropped: true
deleteResultDropped: true

createRecoveredViaSameIdReplay: true
updateRecoveredViaSameIdReplay: true
transformRecoveredViaSameIdReplay: true
addRecoveredViaSameIdReplay: true
propertyRecoveredViaSameIdReplay: true
removeRecoveredViaSameIdReplay: true
deleteRecoveredViaSameIdReplay: true

createLifecycleStatus: completed
updateLifecycleStatus: completed
transformLifecycleStatus: completed
addLifecycleStatus: completed
propertyLifecycleStatus: completed
removeLifecycleStatus: completed
deleteLifecycleStatus: completed

finalPositionVerified: true
removedComponentStillPresent: false
temporaryObjectRemaining: false
```

This is real response-loss verification rather than a mocked Unity response. The final gate also proves that the Transform native readback matched the requested position, the removed Component no longer resolved, and the temporary GameObject was deleted.

The earlier PR #53 first-slice verifier exposed and fixed a verifier-only WebSocket framing bug: forwarding Node `ws` `RawData` directly could convert JSON text to a binary frame on the Unity-facing leg. The final proxy explicitly preserves JSON as text frames.

## Verification boundary

This verification demonstrates current-process/current-session response-loss reconciliation for the seven reviewed common `EditorMutationTransaction` scene-edit operations.

It does **not** prove:

- durability across a full Unity Editor process restart;
- generic arbitrary retry safety;
- generic historical mutation rollback or Undo;
- reconciliation for mutation families outside the explicit allowlist;
- unification of Script, persistent Prefab/asset, Play Mode, or Test Runner journals.

No Unity C# production code changed in PR #54, so the previously verified installed-package EditMode baseline remains **111/111**; PR #54 changes transport reconciliation admission plus Node/live verification coverage only.
