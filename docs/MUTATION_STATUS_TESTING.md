# Mutation Status Testing

This gate verifies the first bounded `mutation.status` / `unity_get_mutation_status` slice against a real Unity Editor.

## Environment used for the current verification series

- Windows
- Unity 6000.3.21f1
- project with the current `com.eunsung.unity-ai-bridge` package loaded
- Node version matching `.nvmrc` / package engine requirements

## Automated Node gate

From the repository root:

```text
npm --prefix mcp-server test
```

This covers bridge request risk/arguments, bounded payload validation, `not_found` semantics, and invalid mutation-id rejection before Unity delivery.

## Real Unity EditMode gate

Run the expanded package EditMode suite through Unity Test Runner. The new `MutationStatusCommandTests` cover:

- unknown current-session journal id remains unknown and never claims safe retry;
- a `started` lifecycle requires native reconciliation;
- a `completed` lifecycle is terminal and points to operation-specific same-id replay/re-observation;
- rollback failure requires manual reconciliation;
- malformed mutation ids are rejected.

Do not update the canonical passing-test baseline until the full installed-package suite has actually completed on the candidate revision.

## Live MCP gate

With Unity open and connected to the local bridge, from the repository root run:

```text
npm --prefix mcp-server run verify:mutation-status
```

The verifier uses the official MCP TypeScript client over stdio and the normal MCP server. It:

1. requires the MCP server to advertise `unity_get_mutation_status`;
2. waits for Unity capabilities `mutation.status`, `state.revision.v1`, `gameObject.create`, and `gameObject.delete`;
3. queries a unique unknown mutation id and requires `found=false`, `status=not_found`, `safeToBlindRetry=false`, and `recommendedAction=reobserve_native_state`;
4. creates one uniquely named temporary GameObject using an explicit mutation id and a fresh scene state token;
5. queries that mutation id and requires the common lifecycle journal to report terminal verified `gameObject.create` completion metadata;
6. repeats the status read and verifies the scene state token and temporary-object count do not change because status observation is read-only;
7. deletes the temporary GameObject with another explicit mutation id and fresh state token;
8. verifies that deletion also appears as a completed common lifecycle record;
9. confirms the temporary object is absent at the end.

The verifier attempts best-effort cleanup on failure and prints the exact temporary name / GlobalObjectId if manual cleanup is still needed.

## Verification boundary

Passing this gate proves only the first-slice scope:

- common `EditorMutationTransaction` lifecycle records in the current Editor session;
- read-only external observation through MCP;
- no blind-retry claim for unknown or recorded states.

It does not prove full Editor-restart durability and does not imply that Script, persistent Prefab/asset, Play Mode, or Test Runner operation-specific journals have been unified.
