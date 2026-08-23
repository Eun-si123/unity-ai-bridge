# Component Property Edit — Phase 3 First Slice

Status: **Implemented on branch; runtime verification required before merge.**

## Purpose

`component.property.set` edits one exact visible Unity `SerializedProperty` on one exact non-Transform `Component` without exposing arbitrary reflection or arbitrary C# execution.

The matching MCP tool is `unity_set_component_property`.

## Target identity

The command requires:

- an exact Component `GlobalObjectId`, normally obtained from `unity_get_components`,
- an exact visible `propertyPath` returned by Component inspection,
- a fresh `expectedStateEpoch` + `expectedStateRevision`,
- an optional `mutationId` for ambiguous-retry reconciliation.

A GameObject ID is not silently reinterpreted as a Component ID.

`Transform` / `RectTransform` targets are rejected by this generic property tool. Transform state continues to use the dedicated `transform.set` contract, whose semantic verifier understands Transform-specific rotation/scale behavior.

## Visible-property boundary

Unity resolves the Component with `GlobalObjectId`, builds a `SerializedObject`, and enumerates properties with `SerializedProperty.NextVisible`.

Only a path found in that visible surface is eligible. The implementation does not use unrestricted reflection to discover private runtime state and does not use `FindProperty` as a bypass for hidden fields.

Additional policy:

- `m_Script` is never editable through this command,
- `SerializedProperty.editable == false` is rejected,
- unsupported property types fail closed,
- value types are not implicitly coerced.

## First supported value kinds

The first slice deliberately supports a small set whose native readback can be compared precisely:

| Bridge value kind | Unity SerializedProperty type |
|---|---|
| `boolean` | `Boolean` |
| `integer` | `Integer` |
| `number` | `Float` |
| `string` | `String` |
| `vector3` | `Vector3` |

The MCP schema uses one explicit `valueKind` plus exactly one matching value field. Supplying the wrong value field or several competing value fields is rejected before delivery to Unity.

Not yet supported include enums, object references, exposed references, colors, quaternions, integer vectors, arrays/lists, managed references, animation curves, gradients, bounds/rect values, and container-level structural editing.

## Mutation flow

For a first-time changed request:

1. validate target/path/value/mutation/state arguments,
2. reject compilation or stale state in common mutation preflight,
3. resolve the exact Component and require its owner to be in the active scene,
4. require the exact path to be visible and editable,
5. capture the original typed property value,
6. assign the requested value on the `SerializedProperty`,
7. apply through `SerializedObject.ApplyModifiedProperties`,
8. mark the active scene dirty,
9. re-resolve the same Component/property from native Unity state,
10. verify owner/type/Component identity plus the requested typed value,
11. collapse the Undo group and record the post-write state revision.

If native semantic verification fails after Unity state changed, the common mutation transaction reverts the Undo group. The property-specific rollback verifier then confirms that the original typed value and Component identity/ownership/index/scene were restored.

A request already matching the native property value completes as `changed=false` without preparing a new serialized mutation.

## Replay behavior

A completed same-`mutationId` replay must match the original target, property path, requested typed value, and original state precondition.

Before returning the cached completion, Unity re-resolves the Component and visible property and confirms the completed requested value is still present.

If the user Undoes or otherwise changes the property after completion, the same mutation id fails closed with `stale_target/mutation_replay_stale`; it does not silently reapply the old property value.

## Deadline and risk

`component.property.set` uses `risk=write`.

Like the other current write families, the dispatcher re-checks the request deadline immediately before execution. A command that expires while queued does not begin its Unity mutation body.

## Verification gate for this slice

Before this slice is marked Verified:

- GitHub Node Verification must pass,
- GitHub local bridge regression must pass,
- Unity 6000.3.21f1 must compile the package with no new errors,
- the EditMode suite must report **45 Passed / 0 Failed**,
- `npm.cmd --prefix mcp-server run verify:component-properties` must verify real `BoxCollider` Boolean/Vector3 writes, native inspection readback, same-id replay, Undo restoration of `m_Size`, stale replay rejection after Undo, and automatic temporary GameObject cleanup.
