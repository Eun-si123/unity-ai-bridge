# Changelog

All notable project changes are recorded here by implementation phase.

The project is pre-alpha. Internal package version `0.0.1` does not represent a public release.

## Unreleased

### Phase 2 — Stable Object Resolver / Native Readback — In progress

#### Added

- `ObjectResolverCommand` using Unity `GlobalObjectId` parsing and native object re-resolution.
- Bridge `object.resolve` and MCP `unity_resolve_object` read path.
- Native readback of newly created GameObjects before a successful `gameObject.create` result is cached.
- Revalidation of cached create mutations before deduplicated replay.
- Fail-closed stale replay behavior: if the original object has been undone, deleted, renamed, moved, or otherwise no longer matches the cached result, identical mutation replay is rejected instead of recreating state or returning stale success.
- Simulated Node resolver tests, resolver protocol fixtures, and `verify:resolver` live verifier.
- Resolver verifier now diagnoses `unsupported/operation_not_supported` for `object.resolve` as a likely stale Unity AI Bridge Editor assembly and tells the operator to reimport/recompile or restart Unity before retrying.

#### Verification so far

- Node Verification and local bridge CI: **PASS**.
- First real Unity resolver attempt: **FAIL / diagnostic evidence**, because the connected Unity Editor was still running an older compiled Unity AI Bridge assembly and returned `unsupported/operation_not_supported: Operation 'object.resolve' is not implemented.`
- Branch source was checked after the failure and does contain the `object.resolve` dispatcher route; therefore the observed failure is currently classified as Unity package/domain version skew, not an absent source implementation.
- Real Unity compile + resolver/Undo/stale-replay verification remains required before this slice can be marked Verified or merged.

### Governance

- Adopted the **Apache License 2.0** for the public `unity-ai-bridge` repository.
- Added the root `LICENSE` file using the standard Apache-2.0 license text.
- Clarified that the separate private `unity-ai-mcp-infra` repository is not automatically licensed under the public core's Apache-2.0 license.
- Closed the Phase 0 "project license selected" governance item.

### Phase 1 — Console / Compiler Diagnostics — Verified slice

#### Added

- Unity `editor.diagnostics` read operation.
- MCP `unity_get_diagnostics` with bounded `maxEntries` and `minimumSeverity` inputs.
- Current Unity Console error/warning/log counts through public `ConsoleWindowUtility.GetConsoleLogCounts`.
- Recent Console message capture through `Application.logMessageReceivedThreaded`.
- Compiler warning/error capture through `CompilationPipeline.assemblyCompilationFinished`.
- Latest compilation snapshot persistence through domain reload using Editor `SessionState`.
- Explicit coverage metadata so callers know recent log text only covers the current domain-load capture window.
- Bounded message/stack lengths and bounded compiler/Console entry counts.
- Node routing/result/input-validation tests.
- `verify:diagnostics` for a live bounded diagnostics read.
- `verify:compiler-error` for intentional compiler-error capture with source location metadata.
- Diagnostics protocol fixtures and documentation.

#### Verification

- Node Verification: **PASS**.
- Phase 1 Local Bridge Verification: **PASS**.
- Unity 6000.3.21f1 package compile: **PASS (manual Windows verification, 2026-08-23)**.
- Real `verify:diagnostics`: **PASS**; observed Console counts `errors=0`, `warnings=1`, `logs=1`, and a captured Unity AI Bridge reconnect warning with full stack trace.
- Real `verify:compiler-error`: **PASS** after creating a temporary `Assets/MCPCompileErrorTest.cs` that referenced `ThisSymbolDoesNotExist`.
- Captured compiler result: severity `error`, `CS0103`, file `Assets\\MCPCompileErrorTest.cs`, line `5`, column `21`, assembly `Library/ScriptAssemblies/Assembly-CSharp.dll`.
- Matching compiler error also appeared in recent Console capture.
- The implementation intentionally avoids unsupported/internal `UnityEditor.LogEntries` for historical Console text access.

#### Phase 1 milestone

- **Phase 1 — Minimal Local End-to-End completed on 2026-08-23.**
- Verified minimum capabilities now include editor status, active-scene hierarchy, one bounded GameObject mutation with duplicate-retry protection, and bounded Console/compiler diagnostics.
- Development advances to **Phase 2 — Reliability Core**, where narrow Phase 1 reliability primitives are generalized into common preflight/transaction/readback/verification/rollback infrastructure.

### Phase 1 — GameObject Create / Mutation Retry Protection — Verified slice

#### Added

- Unity `gameObject.create` write operation for one empty root GameObject in the active scene.
- MCP `unity_create_game_object` tool with bounded name validation and `risk=write` routing.
- Explicit `mutationId` idempotency key for ambiguous retry protection; the MCP side generates one when omitted and returns it in ambiguous failure text.
- Unity `SessionState` storage of completed create results so the same mutation ID survives domain reload during the Editor session.
- Reuse protection: same mutation ID + same arguments replays the prior result; same mutation ID + different arguments is rejected.
- Unity Undo registration, active-scene dirty marking, and structured result metadata including `GlobalObjectId`, transient `instanceId`, scene, hierarchy path, and sibling index.
- Node bridge tests for write-risk routing, explicit mutation-ID reuse, and pre-delivery input validation.
- `verify:create` using the official MCP TypeScript client to wait for Unity, create once, repeat the same mutation ID, and verify via hierarchy readback that only one matching object exists.
- Protocol v0 GameObject-create command/result fixtures and operation documentation.

#### Fixed during verification

- The first real verifier attempt called `unity_create_game_object` immediately after MCP startup, before Unity had connected, and failed with `No Unity Editor is connected to the local bridge.`
- The verifier now polls `unity_get_status` for up to 30 seconds before the first write.
- Retryable connection/timeout/stale-route ambiguity reuses the **same** mutation ID instead of creating a fresh write identity.

#### Verification

- Revision `2969bcfa379f10498d4b5bac69fb085f209d499d`: Node Verification run `32606458264` **PASS** and Phase 1 Local Bridge Verification run `32606458269` **PASS**.
- Real Unity 6000.3.21f1 / Windows `npm.cmd --prefix mcp-server run verify:create`: **PASS (manual verification, 2026-08-23)**.
- First create returned `replayed=false` and `GlobalObjectId_V1-2-99c9720ab356a0642a771bea13969a05-1399885475-0`.
- Identical retry returned `replayed=true` with the same mutation ID and same `GlobalObjectId`.
- Live `unity_get_hierarchy` readback reported `hierarchyMatches=1`; the Unity Hierarchy visibly contained one generated `MCP_Create_Verify_1787442917163` object.
- Scene dirty state was visible and the create is registered with Unity Undo.

#### Known limitation

- Current duplicate replay trusts the cached same-session result. If the created object is manually deleted or undone before a later replay, the cached replay is not yet revalidated against native Unity state. Phase 2 native readback/verification will close this gap.

### Phase 1 — Active Scene Hierarchy Read — Verified slice

#### Added

- Unity `scene.hierarchy` read operation running through the existing Editor main-thread dispatcher.
- MCP `unity_get_hierarchy` tool with bounded `maxDepth` / `maxNodes` inputs.
- Flat preorder hierarchy result containing Unity `GlobalObjectId`, transient `instanceId`, parent identity, depth, sibling index, child count, active state, and informational hierarchy path.
- Default traversal bounds of depth 8 / 200 nodes and hard bounds of depth 32 / 500 nodes.
- `truncatedByDepth` and `truncatedByNodes` result flags.
- Batched `GlobalObjectId.GetGlobalObjectIdsSlow` lookup instead of per-node conversion calls.
- Simulated Node bridge tests for hierarchy routing/result validation and invalid limit rejection.
- `verify:hierarchy` command using the official MCP TypeScript client to call `unity_get_hierarchy` against a live Unity Editor.
- Protocol v0 hierarchy request/result fixtures.

#### Fixed during implementation

- First hierarchy CI build exposed `exactOptionalPropertyTypes` rejecting explicitly forwarded `undefined` option fields. The MCP handler now omits absent option properties before calling the bridge.
- Real Unity 6000.3.21f1 compilation exposed a `GlobalObjectId.GetGlobalObjectIdsSlow` signature mismatch: the current target requires a preallocated output array without the C# `out` modifier. `HierarchyCommand` now allocates `GlobalObjectId[]` and passes it directly.

#### Verification

- Initial revision `7ccc84b8f3f3176ed04b6662293a5a7ce1741780`: **FAIL at TypeScript build** due to the optional-property issue above; tests did not run.
- Node Verification run `32568901972` and Phase 1 Local Bridge Verification run `32568901982` at revision `2619472abe97ffe9149e05fbe826936f439d62e2`: **PASS**.
- Unity 6000.3.21f1 hierarchy compile before compatibility fix: **FAIL** with CS1615 at `GetGlobalObjectIdsSlow(..., out ...)`.
- Unity 6000.3.21f1 compile after compatibility fix `005327886b6ed40f35c8338559e721d256d900b6`: **PASS (manual Windows verification, 2026-08-22)**.
- Unity MCP hierarchy read: **PASS**.

### Phase 1 — Local Unity Heartbeat / `editor.status` — Verified slice

#### Added

- Local WebSocket bridge server bound to `127.0.0.1:5081`.
- Unity outbound `ClientWebSocket` connection/reconnect loop.
- Bridge protocol v0 `hello` schema with editor identity and `connectionGeneration`.
- Unity Editor main-thread dispatcher boundary for Unity API access.
- `editor.status` bridge operation returning Unity version, project name, active scene, Play Mode state, and compilation state.
- MCP `unity_get_status` tool wired through the local bridge.
- Request ID correlation, deadlines/timeouts, disconnect handling, stale-generation rejection, bounded payloads, and serialized Unity-side sends.
- Simulated Unity WebSocket integration tests covering hello/status round-trip and the no-editor failure path.
- Simulated explicit-route test covering propagation of `routing/stale_connection`.
- Phase 1 design document and CI workflow.
- `docs/TESTING.md` with repeatable Node, Unity compile, real bridge, MCP end-to-end, and reconnect verification procedures.
- `verify:unity`, `verify:mcp-unity`, and `verify:reconnect` developer commands.

#### Verification

- Node Verification and Phase 1 Local Bridge Verification: **PASS**.
- Unity 6000.3.21f1 package load/compile: **PASS**.
- Real Unity WebSocket hello/status: **PASS**.
- Real MCP stdio `unity_get_status`: **PASS**.
- Real domain reload reconnection: **PASS**.
- Real stale-generation rejection: **PASS**.
- Successful post-reconnect status: **PASS**.

## Phase 0 — Foundation Runtime Scaffold — 2026-08-22

### Added

- Initial project README and scope.
- Mandatory AI/contributor guardrails in `AGENTS.md`.
- Canonical implementation/verification tracking in `STATUS.md`.
- High-level architecture summary in `ARCHITECTURE.md`.
- Durable detailed system design in `DESIGN.md`.
- Architecture decision history in `DECISIONS.md`.
- Public capability-gated roadmap in `ROADMAP.md`.
- Repository/source layout tracking in `CODEMAP.md`.
- Compact AI-agent entrypoint in `llms.txt`.
- `REFERENCES.md` for external research influences that are not incorporated code.
- Initial `unity-package/` UPM scaffold targeting Unity 6000.3.21f1.
- Initial bridge protocol v0 command/result JSON Schemas and editor-status fixtures.
- Bridge protocol v0 C# and TypeScript version/type definitions.
- Initial `mcp-server/` TypeScript MCP v2 stdio bootstrap.
- Strict TypeScript build configuration and Node test-runner protocol smoke tests.
- Root build/test delegation, Node 24.19.0 runtime pin, and repository ignore rules.
- GitHub Actions Node verification workflow.