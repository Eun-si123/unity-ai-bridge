# Changelog

All notable project changes are recorded here by implementation phase.

The project is pre-alpha. Internal package version `0.0.1` does not represent a public release.

## Unreleased

### Phase 3 — Bounded Common Mutation Lifecycle Status — Verified slice

#### Added

- Unity `mutation.status` read operation and MCP `unity_get_mutation_status`.
- Read-only external access to the existing `EditorMutationLifecycle` records used by `EditorMutationTransaction`; no second transaction system was introduced.
- Explicit journal metadata: `editor_mutation_lifecycle_v1`, `current_editor_session`, and `editor_mutation_transaction_v1` coverage.
- Conservative lifecycle statuses and recommended next actions for unknown, started, completed, clean-failure, rollback-failure, and rollback-verification-failure states.
- Privacy boundary that reports only whether immutable intent identity was recorded and never exposes the raw internal intent fingerprint.
- `safeToBlindRetry=false` for every result in this first slice.
- Protocol fixtures, Node validation/routing coverage, Unity EditMode contract tests, and the live `verify:mutation-status` MCP verifier.
- Fail-closed `gameObject.create` preflight for unsaved/temporary active scenes that cannot support durable `GlobalObjectId` scene-object identity.

#### Verification

- PR #52 head `0ee75f40d5fab8b16163015f76820879ac61104a`: Node Verification **PASS** and Phase 1 Local Bridge Verification **PASS**.
- Real Windows + Unity 6000.3.21f1 installed-package EditMode suite: **111 Passed / 0 Failed**.
- Live `verify:mutation-status`: **PASS** with saved active scene `Assets/SampleScene.unity`.
- Unique unknown mutation ID returned `found=false`, `status=not_found`, `safeToBlindRetry=false`, and `recommendedAction=reobserve_native_state`.
- Temporary `gameObject.create` completed and the lifecycle journal observed state revision **60 -> 61**.
- Repeating the mutation-status read did not advance the Unity scene state token.
- Temporary `gameObject.delete` completed and the lifecycle journal observed state revision **61 -> 62**.
- Final hierarchy verification reported no temporary verifier object remaining.

#### Fixed during verification

- The first added unsaved-scene regression test incorrectly assumed an additive temporary scene could always be created; Unity rejects that setup when the current active untitled scene is already unsaved. The fixture now reuses an already-unsaved scene when available and otherwise creates an isolated additive temporary scene without replacing the user's scene.
- The first live verifier duplicated an obsolete mutation-status payload schema and stale recommended-action names. The verifier now imports and reuses the production mutation-status validator so contract drift cannot silently recur in that form.

#### Scope / non-goals

- Verified durability is the **current Unity Editor session** through `SessionState`; full Editor-restart persistence is not claimed.
- First-slice coverage is the common `EditorMutationTransaction` journal only. Script, persistent Prefab/asset, Play Mode, and Test Runner retain operation-specific journals.
- `not_found` never proves that no side effect occurred and never grants permission for a blind retry.
- No generic Undo endpoint, arbitrary historical rollback, automatic retry, or cross-journal unification is introduced.

### Phase 3 — Native Test Framework Discovery — Verified slice

#### Added

- Unity `test.list` read operation and MCP `unity_list_tests` for the Test Framework tree Unity actually discovers.
- EditMode/PlayMode assembly discovery and exact leaf `fullName` selectors without source-text inference.
- Optional bounded case-insensitive `nameContains` filtering.
- Deterministic ordinal paging with `offset` / `maxResults`, a 200-result maximum, and monotonic past-end cursor semantics.
- `selectableByBridge` compatibility reporting for the current 512-character exact-run selector bound.
- Protocol fixtures, Node bridge coverage, five EditMode contract tests, and the `verify:test-discovery` live MCP verifier.

#### Verification

- Product head `736103567e863eb27f1035c431f6dc6aec023bb7`: Node Verification **PASS** and Phase 1 Local Bridge Verification **PASS**.
- Real Windows + Unity 6000.3.21f1 installed-package EditMode suite: **105 Passed / 0 Failed**.
- Live `verify:test-discovery`: **PASS**.
- Native discovery exposed `EunSung.UnityAiBridge.Editor.Tests` with `testCaseCount=105` and exactly five discovery-contract leaves.
- Deterministic first/second-page ordering and past-end cursor behavior were verified.
- PlayMode discovery exposed `EunSung.UnityAiBridge.PlayMode.Tests` with one exact selector matching the previously verified one-frame PlayMode test.
- Unknown exact assembly rejection, stable final Edit Mode, unchanged scene state epoch/revision, and `projectMutated=false` were verified.

#### Clarified

- Installed-package Test Runner **visibility/bootstrap** (`testables` + guarded reimport) is distinct from Test Framework **native selector discovery** (`unity_list_tests`).
- Native discovery is read-only and does not run tests or enter Play Mode.

### Governance

- Adopted the **Apache License 2.0** for the public `unity-ai-bridge` repository.
- Added the root `LICENSE` file using the standard Apache-2.0 license text.
- Clarified that the separate private `unity-ai-mcp-infra` repository is not automatically licensed under the public core's Apache-2.0 license.
- Closed the Phase 0 "project license selected" governance item.

### Phase 2 — Stable Object Resolver / Native Create Readback — Verified slice

#### Added

- Unity `object.resolve` read operation backed by `GlobalObjectId.TryParse` and `GlobalObjectIdentifierToObjectSlow`.
- MCP `unity_resolve_object` tool returning current native object/type/scene/hierarchy metadata while keeping `InstanceID` and hierarchy paths non-durable.
- Native `GlobalObjectId` readback for `gameObject.create` before a first success is cached.
- Cached mutation replay revalidation against current Unity native state.
- Fail-closed stale replay: if the cached create target was Undone/deleted/moved/renamed or no longer matches, the same mutation ID returns `stale_target/mutation_replay_stale` instead of recreating or reporting stale success.
- Resolver protocol fixtures, simulated Node bridge tests, and `verify:resolver` live verification helper.
- Phase 2 tracking for Unity Agent capability/version negotiation after a real server/Agent version-skew failure was observed.

#### Verification

- Node Verification and Local Bridge Verification: **PASS** on the Phase 2 resolver branch.
- Real Unity 6000.3.21f1 `verify:resolver`: **PASS (manual Windows verification, 2026-08-23)**.
- First create returned `replayed=false`; native resolver returned `found=true` with the same canonical `GlobalObjectId`, `instanceId`, name, scene, and `UnityEngine.GameObject` type.
- After one Unity Undo, resolver returned `found=false` for the same `GlobalObjectId`.
- Retrying the same mutation ID returned `stale_target/mutation_replay_stale` and did not create a replacement.
- Final hierarchy readback reported `hierarchyMatches=0`.

#### Fixed during verification

- The first resolver attempt connected a newer MCP server to an older loaded Unity Agent assembly and reached `unsupported/operation_not_supported` for `object.resolve`.
- Reimport/reload brought the Unity Agent source and server back into sync.
- The live verifier now gives an explicit stale-Unity-assembly diagnostic for this failure mode; a real hello/capability negotiation mechanism remains Phase 2 work.

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
- Real MCP `unity_get_hierarchy` against live Unity 6000.3.21f1: **PASS (manual Windows verification, 2026-08-22)**.
- Returned live `SampleScene` hierarchy: `rootCount=3`, `returnedNodeCount=3`, default depth/node limits 8/200, no truncation, and roots `Main Camera`, `Directional Light`, `Global Volume` in sibling order 0/1/2 with non-empty `GlobalObjectId` values.

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

#### Dependencies

- Added exact `ws` `8.21.3` runtime dependency.
- Added exact `@types/ws` `8.18.1` development dependency.
- Added exact `@modelcontextprotocol/client` `2.0.0` development dependency for the MCP verifier.
- Refreshed `mcp-server/package-lock.json` with the Phase 1 dependency graph.

#### Fixed

- Corrected WebSocket send callback handling so both `null` and `undefined` are treated as successful sends.
- Made WebSocket test/server teardown deterministic so transport cleanup details do not mask request-path failures.

#### Verification

- Node Verification and Phase 1 Local Bridge Verification: **PASS** on the merged heartbeat/status slice.
- Unity 6000.3.21f1 package load/compile: **PASS**.
- Real Unity WebSocket hello/status: **PASS**.
- Real MCP stdio `unity_get_status`: **PASS**.
- Real domain reload reconnection: **PASS** with stable editor identity and new connection generation.
- Real stale-generation rejection: **PASS** with `routing/stale_connection`.
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
- Generated `mcp-server/package-lock.json` dependency lockfile.

### Changed

- Moved the project from documentation-only foundation work to an initial runtime/source scaffold.
- Pinned the initial direct MCP/server toolchain to Node 24.19.0, `@modelcontextprotocol/server` 2.0.0, TypeScript 7.0.2, and `@types/node` 24.13.3.
- Recorded successful CI verification for lockfile generation, `npm ci`, TypeScript build, and protocol smoke tests.
- Clarified that a public GitHub repository is **not** an open-source license; the project license was still undecided at the time of the Phase 0 scaffold merge.
- Separated accepted design decisions from implementation status in `STATUS.md`.
- Clarified the public-core/private-managed-service boundary and third-party reference policy.

### Verification at Phase 0 merge

- Node/MCP dependency install, TypeScript build, and protocol smoke tests: **Verified by GitHub Actions**.
- Unity 6000.3.21f1 package load/compile: later manually verified during Phase 1.
- Project license: later resolved to Apache-2.0 in Unreleased.
