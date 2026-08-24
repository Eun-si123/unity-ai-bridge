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

If automatic enabling cannot update the project manifest, use `Tools > Unity AI Bridge > Enable Package Tests` or add the package manually to the project's `testables` array.

Verified history: 75/75 after Test Runner bootstrap, 80/80 after Prefab-property apply, 81/81 after PR #43 direct scene-Prefab override recording, and **85/85** after PR #44 bounded Script read.

## 4. Unity EditMode suite

After package tests are visible in Test Runner:

1. select **EditMode**,
2. run `EunSung.UnityAiBridge.Editor.Tests`,
3. record passed/failed counts,
4. clean any temporary Assets/objects created by the test or verifier path,
5. do not overwrite the last verified count in `STATUS.md` with a new count unless the exact candidate/environment actually ran.

Latest real Unity evidence:

```text
Date: 2026-08-24
Candidate: PR #44 head cee29f4bc364cce60e1dcf8dbb77e9cfc9d63020
Environment: Windows + Unity 6000.3.21f1
Action: EditMode Run All
Observed: 85 Passed / 0 Failed
Result: PASS
Merged as: f0715f883bf7c921ed41e1a153b3489bd4f56352
```

## 5. Bounded Prefab property apply Unity verification gate

PR #36 adds the first persistent existing-Prefab modification: `prefab.property.apply` / `unity_apply_prefab_property_override`. Test-harness compatibility was hardened through PRs #37–#40.

The EditMode integration test creates a temporary Prefab Asset and durable saved test Scene, applies one `m_LocalScale` override, verifies source/instance readback, same-id replay, stale replay after asset deletion, and cleanup. It is Verified as part of the 80/80 real Unity run.

The first slice intentionally excludes `m_Script`, arrays/elements, Model Prefabs, Apply All, component/object-wide apply, and automatic nested-Prefab target selection. Because this operation persistently modifies an existing asset and cannot safely promise generic Unity Undo/rollback, ambiguous execution or failed semantic verification must not trigger blind automatic retry.

## 6. Live MCP Prefab property apply end-to-end gate

Run with Unity open on a saved active Scene:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:prefab-property-apply
```

This uses the official MCP TypeScript client over stdio and checks the real public path: create source object -> add BoxCollider -> create Prefab -> instantiate -> create `m_IsTrigger` instance override -> apply one property -> verify changed dependencyHash -> same-id replay -> fresh independent instance readback -> manual verifier-Prefab deletion -> stale replay rejection -> cleanup.

**Verified evidence:** this live MCP gate passed on 2026-08-24 against Unity 6000.3.21f1. The direct `Undo.RecordObject` Prefab-instance audit discovered while designing it was subsequently fixed by #41 / PR #43 and verified by the 81/81 EditMode run.

## 7. Bounded Script read Unity + MCP gate

PR #44 introduces the first Script workflow as read-only `script.read` / `unity_read_script`.

### EditMode gate

The full PR #44 candidate suite completed:

```text
85 Passed
0 Failed
```

The four Script-read tests verify:

1. Assets and Packages `.cs` paths are accepted,
2. traversal, backslashes, non-script extensions, and paths outside Assets/Packages are rejected,
3. the installed package's `BridgeProtocol.cs` can be read through small chunks while GUID, path, dependencyHash, raw SHA-256, byte count, and character count remain stable,
4. an offset beyond the decoded source length is rejected.

### Live MCP gate

Command:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:script-read
```

No saved Scene or manual Project-window action is required. The verifier starts the normal MCP server over stdio, confirms `unity_read_script`, waits for live `script.read`, reads `Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs` in 64-code-unit chunks, reconstructs the exact source, and verifies stable identity/hash/encoding/size metadata plus immediate repeat stability.

Observed PASS record on 2026-08-24:

```text
unityVersion: 6000.3.21f1
scriptPath: Packages/com.eunsung.unity-ai-bridge/Editor/Protocol/BridgeProtocol.cs
guid: 535573b5098b07445b02ce5ea969259d
sourceKind: Packages
packageName: com.eunsung.unity-ai-bridge
dependencyHash: 1b006f5ec0facfe79226658b89960cda
contentSha256: b52e965c2c01290b03ba70ca1ca60f6eb62870b4665a821632e5993d7d776fc7
encoding: utf-8
hasUtf8Bom: false
byteLength: 206
utf16CharCount: 206
lineCount: 9
chunkSize: 64
chunkCount: 4
reconstructedExactly: true
chunkIdentityStable: true
immediateRepeatStable: true
projectMutated: false
```

The read surface is intentionally bounded: exact `.cs` Unity assets only, Assets/Packages only, strict UTF-8 with optional BOM, at most 4 MiB per source file, at most 100,000 UTF-16 code units returned per call, and paging offsets limited to the C# `int` range.

This gate is now **Verified**. GitHub Actions alone was not used as proof of the real Unity behavior.

## 8. Script replace/write gate — next reliability family

Script mutation is a separate reliability family. A `.cs` change can lead to AssetDatabase import, script compilation, assembly reload, and domain reload, so its verifier must cover more than file readback.

The first bounded write should require:

- exact writable `Assets/*.cs` target,
- current raw `contentSha256` from `script.read` as a compare-and-swap precondition,
- explicit mutationId/replay identity,
- defined UTF-8/BOM/newline behavior,
- bounded replacement content,
- a pre-write re-hash that fails stale without touching the file,
- persistent new-byte readback with a new raw SHA,
- AssetDatabase import/compile observation,
- reconnect/domain-reload reconciliation,
- diagnostics/compiler outcome,
- fail-closed handling for ambiguous started-but-not-terminal writes.

Package scripts remain read-only in the initial write slice.

The write verifier should distinguish at least these outcomes:

```text
stale_content      -> no bytes changed
write_failed       -> persistence failed
written            -> exact new bytes confirmed
compile_succeeded  -> Unity accepted resulting compilation
compile_failed     -> bytes persisted but compiler diagnostics contain failure
ambiguous          -> do not automatically repeat same mutationId
```

A compile failure is not automatically a file-write failure. Source-file persistence is not Unity Undo, so recovery/rollback behavior must be designed and tested explicitly.

## 9. Real local bridge + `editor.status` verification helper

With the Unity project open and the package loaded:

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:unity
```

The helper listens on the local bridge, waits for the real Unity Editor hello, sends `editor.status`, and prints structured Unity/project/scene/play/compile state. This verifies the real WebSocket/bridge path, not MCP stdio by itself.

## 10. Real MCP `unity_get_status` end-to-end check

```text
npm --prefix mcp-server ci
npm --prefix mcp-server run verify:mcp-unity
```

The official MCP client launches the normal server, completes MCP initialization, calls `unity_get_status`, and validates its structured result against the live Editor.

## 11. Reconnect / domain reload / stale-generation check

```text
npm --prefix mcp-server run verify:reconnect
```

When prompted, trigger a Unity script/domain reload. PASS requires the same editor identity to reconnect with a new connection generation, an intentionally old-generation route to fail with `routing/stale_connection`, and a current-generation status call to succeed.

## 12. Hierarchy and object-resolution checks

Hierarchy:

```text
npm --prefix mcp-server run verify:hierarchy
```

Stable resolver / stale replay:

```text
npm --prefix mcp-server run verify:resolver
```

If an operation exists in checked-out source but Unity reports it unsupported, treat stale compiled package state as a candidate first; reimport/restart and re-run before concluding the operation is absent.

## 13. Phase 3 domain verification

Each new write family must carry the Phase 2 reliability contract appropriate to its domain before being marked Verified:

- capability/version preflight,
- stable target identity,
- current-state/content preconditions where required,
- main-thread execution where required,
- explicit risk/persistence classification,
- Undo grouping where applicable,
- mutation identity/replay behavior,
- native semantic readback,
- rollback + rollback verification where safe and applicable,
- conservative ambiguous-outcome behavior where a persistent write cannot safely provide generic rollback,
- deadline behavior,
- dirty/save/compile semantics,
- real Unity verification in addition to simulated/Node tests.

Domain-specific verifier scripts and exact evidence belong in `STATUS.md` / linked docs rather than being inferred from source presence.

## 14. Evidence format

Every real verification entry added to `STATUS.md` should record:

```text
Date:
Revision/candidate:
Environment:
Action/command:
Expected:
Observed:
Result: PASS / FAIL / PARTIAL
Notes:
```

Do not mark real Unity behavior Verified from Node simulation, source inspection, or a roadmap checkbox alone.
