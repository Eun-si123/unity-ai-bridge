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

Unity's package-test behavior differs between embedded and non-embedded packages. For a non-embedded Local, LocalTarball, or Git install, Unity AI Bridge adds `com.eunsung.unity-ai-bridge` to the consuming project's top-level `Packages/manifest.json` `testables` array automatically.

Verification procedure:

1. Start with a Unity project whose `Packages/manifest.json` does **not** already contain `com.eunsung.unity-ai-bridge` in `testables`.
2. Install Unity AI Bridge as a Local/Add-package-from-disk or Git package dependency.
3. Wait for the initial package compile and automatic manifest update.
4. When Test Framework does not immediately load the package test assembly, the bootstrap performs one guarded package reimport for the Editor session.
5. Open **Window -> General -> Test Runner** and select **EditMode**.
6. Confirm assembly `EunSung.UnityAiBridge.Editor.Tests` appears without manually editing the manifest.
7. Confirm the project manifest contains the package exactly once in `testables` and preserves existing dependencies/testable entries.
8. Run the EditMode suite.

Expected automatic sources:

- `PackageSource.Local` — yes
- `PackageSource.LocalTarball` — yes
- `PackageSource.Git` — yes
- `PackageSource.Embedded` — no manifest edit required
- `PackageSource.Registry` — no automatic manifest edit

If automatic enabling cannot update the project manifest, use:

`Tools > Unity AI Bridge > Enable Package Tests`

or add the package manually to the project's `testables` array.

**Verified evidence:** this flow was first reproduced on Unity 6000.3.21f1 on 2026-08-24 with **75 passed / 0 failed**. The later expanded package suite on revision `7787c4b5317e628924f22cedd576964cce20103d` completed **80 passed / 0 failed** with the same installed-package discovery path.

## 4. Unity EditMode suite

After package tests are visible in Test Runner:

1. select **EditMode**,
2. run `EunSung.UnityAiBridge.Editor.Tests`,
3. record passed/failed counts,
4. clean any temporary Assets/objects created by the test or verifier path,
5. do not overwrite the last verified count in `STATUS.md` with a new count unless the exact revision/environment actually ran.

Latest real Unity evidence:

```text
Date: 2026-08-24
Revision: 7787c4b5317e628924f22cedd576964cce20103d
Environment: Windows + Unity 6000.3.21f1
Action: EditMode Run All
Observed: 80 Passed / 0 Failed
Result: PASS
```

## 5. Bounded Prefab property apply Unity verification gate

PR #36 adds the first persistent existing-Prefab modification: `prefab.property.apply` / `unity_apply_prefab_property_override`. Test-harness compatibility for real Unity 6000.3.21f1 was hardened through PRs #37–#40.

The EditMode integration test creates a temporary Prefab Asset and a durable saved test Scene as required by Unity's scene-object `GlobalObjectId` semantics, then cleans its temporary data. It is now **Verified** as part of the 80/80 real Unity run above.

PASS proves:

1. a writable temporary Prefab is copied/imported,
2. a linked scene instance is created,
3. a real `m_LocalScale` serialized Prefab override is produced on the instance Transform,
4. the command accepts the explicit Component `GlobalObjectId`, property path, Prefab path, current dependencyHash, and scene state token,
5. `PrefabUtility.ApplyPropertyOverride` results in the source Prefab storing the overridden value,
6. fresh instance readback reports `prefabOverride == false`,
7. instance/source data match after apply,
8. the completed same-`mutationId` call replays without performing a second asset write,
9. after the test deletes the Prefab asset, the same mutationId fails with stale replay instead of recreating or reapplying anything,
10. the temporary instance/asset/Scene are cleaned even when the test fails.

The first slice intentionally excludes `m_Script`, arrays/elements, Model Prefabs, Apply All, component/object-wide apply, and automatic nested-Prefab target selection.

Because this operation persistently modifies an existing asset and cannot safely promise generic Unity Undo/rollback, ambiguous execution or failed semantic verification must **not** trigger blind automatic retry. Refresh native Unity state before choosing a new mutationId.

## 6. Live MCP Prefab property apply end-to-end gate

PR #42 adds a second, separate gate for the same write family. This checks the path a real MCP host uses rather than calling the C# command directly from EditMode tests.

Prerequisites:

- Unity is open with the current package compiled,
- the active Scene is **saved under `Assets/`** so scene-object `GlobalObjectId` values are durable,
- the Editor is connected to the local bridge,
- no compilation is in progress.

Run from the repository root:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:prefab-property-apply
```

The verifier uses the official MCP TypeScript client over stdio, launches the normal Unity AI Bridge MCP server, and performs the following workflow entirely through public MCP tools until the explicit asset-removal step:

1. verify the required tools and Agent capabilities,
2. create a temporary scene GameObject,
3. add a `UnityEngine.BoxCollider`,
4. create a unique temporary Prefab Asset under `Assets/`,
5. instantiate that Prefab,
6. use `unity_set_component_property` to change `BoxCollider.m_IsTrigger` from `false` to `true`,
7. verify the Prefab Asset dependencyHash did **not** change from the instance-only override,
8. call `unity_apply_prefab_property_override` with the exact Component ID, property path, Prefab path, dependencyHash, state token, and mutationId,
9. verify the Prefab GUID stays stable while the dependencyHash changes,
10. replay the exact same mutationId/preconditions and require readback-only `replayed=true`,
11. instantiate a fresh second instance from the modified Prefab and verify `m_IsTrigger == true`, proving the persistent Asset change independently of the original instance,
12. clean temporary scene objects through MCP,
13. when prompted, delete the verifier's uniquely named temporary `.prefab` **once** in Unity's Project window,
14. require a same-id retry after asset deletion to fail with `stale_target/mutation_replay_stale`,
15. finish cleanup and print a structured PASS record.

The Component-property path is intentional: it uses Unity `SerializedObject` / `SerializedProperty` semantics, the preferred bounded path for recording Prefab instance property overrides. Direct `Undo.RecordObject` Prefab-instance write behavior is tracked separately in issue **#41** and is not silently assumed by this verifier.

If the verifier fails after creating the temporary Prefab, it prints the exact unique `Assets/UnityAiBridge_Prefab_Property_Apply_Verify_*.prefab` path that must be removed manually. Scene objects are cleaned on a best-effort basis.

Do **not** mark this live MCP gate PASS from GitHub Actions, TypeScript compilation, or the 80/80 EditMode result. Record it only after the command above succeeds against a real Unity Editor.

## 7. Real local bridge + `editor.status` verification helper

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

## 8. Real MCP `unity_get_status` end-to-end check

With Unity still open:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:mcp-unity
```

The verifier uses the official MCP TypeScript client over stdio, launches the normal Unity AI Bridge MCP server, completes MCP initialization, confirms `unity_get_status` is advertised, waits for the live Unity connection, calls the tool, and validates its structured result.

PASS requires the returned Unity version/project/scene/play/compile state to match the actual Editor. A direct bridge call alone is insufficient for this gate.

## 9. Reconnect / domain reload / stale-generation check

With Unity open:

```text
npm --prefix mcp-server run verify:reconnect
```

When prompted, trigger a Unity script/domain reload. PASS requires:

1. the same editor identity reconnects,
2. the new connection generation differs,
3. a command deliberately routed to the old generation is rejected with `routing/stale_connection`,
4. a normal current-generation status call succeeds.

## 10. Hierarchy and object-resolution checks

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

## 11. Phase 3 domain verification

Each new write family must carry the Phase 2 reliability contract appropriate to its domain before being marked Verified:

- capability/version preflight,
- stable target identity,
- current-state preconditions where required,
- main-thread execution,
- explicit risk/persistence classification,
- Undo grouping where applicable,
- mutation identity/replay behavior,
- native semantic readback,
- rollback + rollback verification where safe and applicable,
- conservative ambiguous-outcome behavior where a persistent write cannot safely provide generic rollback,
- deadline behavior,
- dirty/save semantics,
- real Unity verification in addition to simulated/Node tests.

Domain-specific verifier scripts and exact evidence belong in `STATUS.md` / linked docs rather than being inferred from source presence.

## 12. Evidence format

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
