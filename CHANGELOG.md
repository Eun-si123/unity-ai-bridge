# Changelog

All notable project changes are recorded here by implementation phase.

The project is pre-alpha. Internal package version `0.0.1` does not represent a public release.

## Unreleased

### Governance

- Adopted the **Apache License 2.0** for the public `unity-ai-bridge` repository.
- Added the root `LICENSE` file using the standard Apache-2.0 license text.
- Clarified that the separate private `unity-ai-mcp-infra` repository is not automatically licensed under the public core's Apache-2.0 license.
- Closed the Phase 0 "project license selected" governance item.

### Phase 1 — Root GameObject Create — In progress

#### Added

- Unity `scene.create_game_object` mutation for creating one root GameObject in the active scene.
- MCP `unity_create_game_object` tool with required `name` and caller-supplied `idempotencyKey`.
- Explicit bridge `risk: write` classification for the mutation path.
- Same-intent retry protection backed by Unity `SessionState` plus `GlobalObjectId` target identity.
- Fail-closed ambiguous mutation handling: the idempotency key is consumed before Unity state changes, so a reload/error in the narrow pre-completion window does not silently replay the create.
- Same-key/different-arguments conflict rejection.
- Consumed-key/original-target-missing rejection instead of blind recreation after Undo/removal.
- `Undo.RegisterCreatedObjectUndo` integration with `Unity AI Bridge: Create GameObject` as the Undo group name.
- Explicit `EditorSceneManager.MarkSceneDirty` handling without implicit scene save.
- Created-target `GlobalObjectId` reverse readback before reporting success.
- Structured mutation result containing target identity, scene metadata, sibling index, active state, dirty state, create/dedup flags, and Undo group name.
- Simulated Node tests for mutation write routing and create-input validation.
- `verify:create` real MCP verifier that checks first creation, same-key deduplication, and hierarchy readback uniqueness.
- Protocol request/result fixtures and test documentation for the create operation.

#### Verification

- Node Verification run `32570170957` and Phase 1 Local Bridge Verification run `32570170947` at revision `648e3c472f20f6ed805be0d7d3c9e151f8a7b7d9`: **PASS**.
- A later Unity-only safety hardening commit consumes mutation identity before state change; current-head CI is re-run after each branch push.
- Unity 6000.3.21f1 compile/runtime for the create source: **Not yet verified**.
- Real MCP first-create / same-key dedup / hierarchy uniqueness: **Not yet verified**.
- Real Unity Undo removal of the created test object: **Not yet verified**.

Current idempotency storage is scoped to the current Unity Editor session via `SessionState`; cross-Editor-restart mutation durability is intentionally not claimed yet.

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
- `docs/TESTING.md` with repeatable Node, Unity compile, real bridge, MCP end-to-end, and reconnect verification procedures, including a simple C# compile/reload trigger.
- `verify:unity` developer command that waits for a real Unity Editor hello and performs a real `editor.status` round trip.
- `verify:mcp-unity` developer command using the official MCP TypeScript client over stdio to call the real `unity_get_status` tool against live Unity.
- `verify:reconnect` developer command that checks stable editor identity, changed connection generation, stale-generation rejection, and successful post-reconnect status.

#### Dependencies

- Added exact `ws` `8.21.3` runtime dependency.
- Added exact `@types/ws` `8.18.1` development dependency.
- Added exact `@modelcontextprotocol/client` `2.0.0` development dependency for the MCP verifier.
- Refreshed `mcp-server/package-lock.json` with the Phase 1 dependency graph.

#### Fixed

- Corrected WebSocket send callback handling so both `null` and `undefined` are treated as successful sends; CI exposed the original `reject(null)` failure during the status round-trip test.
- Made WebSocket test/server teardown deterministic so transport cleanup details do not mask request-path failures.
- Rebuilt the Phase 1 branch on the squash-merged Phase 0 `main`, and again on the Apache-2.0 licensing `main`, so PR #4 contains Phase 1 changes without losing current governance state.

#### Verification

- Node Verification and Phase 1 Local Bridge Verification: **PASS** on the merged heartbeat/status slice.
- TypeScript build and Node tests: **PASS**.
- Simulated Unity `hello -> editor.status -> structured result`: **PASS**.
- Explicit no-editor failure path: **PASS**.
- Simulated stale-generation error propagation: **PASS**.
- Unity 6000.3.21f1 package load/compile at revision `059727365c025eb1d18013371fe95e055517e570`: **PASS (manual Windows verification, 2026-08-22)**.
- Real Unity WebSocket protocol v0 `hello` to `127.0.0.1:5081`: **PASS**.
- Real bridge `editor.status` round trip: **PASS**.
- Real MCP stdio `unity_get_status` against the live Unity Editor: **PASS**.
- Real domain reload reconnection: **PASS**; same `editorId`, new `connectionGeneration` (`1787395056602` -> `1787395125304`).
- Real stale-generation rejection after reconnect: **PASS** with `routing/stale_connection`.
- Successful post-reconnect `editor.status` on the new generation: **PASS**.

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
- Reduced mandatory AI reading overhead: new/lost-context sessions load the core truth/design context, while routine changes load only relevant documents.
- Clarified that external Unity MCP projects are research references unless exact third-party material is deliberately incorporated.
- Clarified the intended public-core/private-managed-service boundary.

### Removed

- Premature `THIRD_PARTY_NOTICES.md` reference log. A real third-party notice/license file should be added only when incorporated material actually requires one.

### Verification at Phase 0 merge

- Node/MCP dependency install, TypeScript build, and protocol smoke tests: **Verified by GitHub Actions**.
- Unity 6000.3.21f1 package load/compile: **Not yet verified at Phase 0 merge; later manually verified during Phase 1**.
- Project license: **Not yet selected at Phase 0 merge; later resolved to Apache-2.0 in Unreleased**.
