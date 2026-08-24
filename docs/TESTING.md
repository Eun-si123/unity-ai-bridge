# Testing Guide

This document defines the repeatable verification path for Unity AI Bridge. It separates automated Node/protocol checks, Unity EditMode tests, and real Editor/end-to-end verification so implementation is never mistaken for runtime proof.

## 1. Automated Node / protocol verification

Run from the repository root:

```text
npm --prefix mcp-server ci
npm run build
npm test
```

Coverage grows with the tool surface and should include protocol/version guards, local bridge startup, hello/route handling, request/result correlation, input/schema bounds, tool routing, no-editor failures, stale-generation handling, and domain-specific bridge contracts.

GitHub Actions is the canonical CI environment for this Node/protocol layer unless a workflow explicitly runs Unity as well.

## 2. Real Unity 6000.3.21f1 package compile check

Target editor: Unity 6000.3.21f1.

1. Open a clean Unity project with Unity 6000.3.21f1.
2. Add `unity-package/package.json` using Package Manager -> Add package from disk, or install the package through the Git dependency path being tested.
3. Allow Package Manager resolution, script compilation, and any domain reload to finish.
4. Confirm the Unity Console contains zero compile errors caused by Unity AI Bridge.
5. Record warnings separately; warnings are not silently promoted to PASS.

PASS requires the installed package to load and the Editor assembly to compile successfully.

When switching Git branches while Unity remains open, Unity can temporarily keep the previously compiled Editor assembly even though the package source changed. If a newly added operation reports `unsupported/operation_not_supported` but current source contains the route, force package reimport/domain reload or restart Unity before classifying the implementation as missing.

## 3. Installed-package Test Runner discovery check

Unity's package-test behavior differs between embedded and non-embedded packages. For a non-embedded Local, LocalTarball, or Git install, Unity AI Bridge now attempts to add `com.eunsung.unity-ai-bridge` to the consuming project's top-level `Packages/manifest.json` `testables` array automatically.

Fresh verification procedure:

1. Start with a Unity project whose `Packages/manifest.json` does **not** already contain `com.eunsung.unity-ai-bridge` in `testables`.
2. Install Unity AI Bridge as a Local/Add-package-from-disk or Git package dependency.
3. Wait for the initial package compile, the automatic manifest update, Package Manager resolution, and the following recompile/domain reload to finish.
4. Open **Window -> General -> Test Runner** and select **EditMode**.
5. Confirm assembly `EunSung.UnityAiBridge.Editor.Tests` appears without manually editing the manifest.
6. Confirm the project manifest now contains the package exactly once in `testables` and preserves all pre-existing dependencies/testable package entries.
7. Run the EditMode suite.

Expected automatic sources:

- `PackageSource.Local` — yes
- `PackageSource.LocalTarball` — yes
- `PackageSource.Git` — yes
- `PackageSource.Embedded` — no manifest edit required
- `PackageSource.Registry` — no automatic manifest edit

If automatic enabling cannot update the project manifest, use:

`Tools > Unity AI Bridge > Enable Package Tests`

or add the package manually to the project's `testables` array.

**Verification rule:** source-level tests for the manifest transformer do not by themselves prove Test Runner discovery. Mark this feature Verified only after the fresh installed-package procedure above succeeds in a real Unity Editor.

## 4. Unity EditMode suite

After package tests are visible in Test Runner:

1. select **EditMode**,
2. run `EunSung.UnityAiBridge.Editor.Tests`,
3. record passed/failed counts,
4. clean any temporary Assets/objects created by the test or verifier path,
5. do not overwrite the last verified count in `STATUS.md` with a new count unless the exact revision/environment actually ran.

The last recorded verified suite before later unverified changes is **62 passed / 0 failed**. Additional tests introduced afterward increase the source test count but remain unverified until a new Unity run is recorded.

## 5. Real local bridge + `editor.status` verification helper

With the Unity project open and the package loaded, run from the repository root:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:unity
```

The helper builds the TypeScript server, listens on the local bridge, waits for the real Unity Editor hello, sends `editor.status`, and prints the structured result.

Compare the printed status against the open Editor:

- Unity version,
- project name,
- active scene,
- Play Mode state,
- compilation state.

This verifies the real Unity WebSocket/bridge path. It does not by itself prove the MCP stdio transport.

## 6. Real MCP `unity_get_status` end-to-end check

With Unity still open:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:mcp-unity
```

The verifier uses the official MCP TypeScript client over stdio, launches the normal Unity AI Bridge MCP server, completes MCP initialization, confirms `unity_get_status` is advertised, waits for the live Unity connection, calls the tool, and validates its structured result.

PASS requires the returned Unity version/project/scene/play/compile state to match the actual Editor. A direct bridge call alone is insufficient for this gate.

## 7. Reconnect / domain reload / stale-generation check

With Unity open:

```text
npm --prefix mcp-server run verify:reconnect
```

When prompted, trigger a Unity script/domain reload. PASS requires:

1. the same editor identity reconnects,
2. the new connection generation differs,
3. a command deliberately routed to the old generation is rejected with `routing/stale_connection`,
4. a normal current-generation status call succeeds.

## 8. Hierarchy and object-resolution checks

Use the current `main`/candidate branch package source rather than old phase branch names.

Hierarchy:

```text
npm --prefix mcp-server run verify:hierarchy
```

Compare scene path, root objects, ordering, parent/child structure, active states, and returned `GlobalObjectId` values against the live Editor.

Stable resolver / stale replay:

```text
npm --prefix mcp-server run verify:resolver
```

PASS requires native resolution of the created object, `found=false` after Undo/removal, stale-replay rejection for the same mutation ID, and no replacement object creation.

If an operation exists in checked-out source but Unity reports it unsupported, treat stale compiled package state as a candidate first; reimport/restart and re-run before concluding the operation is absent.

## 9. Phase 3 domain verification

Each new write family must carry the Phase 2 reliability contract appropriate to its domain before being marked Verified:

- capability/version preflight,
- stable target identity,
- current-state preconditions where required,
- main-thread execution,
- Undo grouping where applicable,
- mutation identity/replay behavior,
- native semantic readback,
- rollback + rollback verification where applicable,
- deadline behavior,
- dirty/save semantics,
- real Unity verification in addition to simulated/Node tests.

Domain-specific verifier scripts and exact evidence belong in `STATUS.md` / linked docs rather than being inferred from source presence.

## 10. Evidence format

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

Do not mark real Unity behavior Verified from Node simulation, source inspection, or a roadmap checkbox alone.
