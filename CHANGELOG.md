# Changelog

All notable project changes are recorded here by implementation phase.

The project is pre-alpha. Internal package version `0.0.1` does not represent a public release.

## Unreleased

### Governance

- Adopted the **Apache License 2.0** for the public `unity-ai-bridge` repository.
- Added the root `LICENSE` file using the standard Apache-2.0 license text.
- Clarified that the separate private `unity-ai-mcp-infra` repository is not automatically licensed under the public core's Apache-2.0 license.
- Closed the Phase 0 "project license selected" governance item.

### Phase 1 — Active Scene Hierarchy Read — In progress

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

#### Verification

- Initial revision `7ccc84b8f3f3176ed04b6662293a5a7ce1741780`: **FAIL at TypeScript build** due to the optional-property issue above; tests did not run.
- Subsequent Phase 1 Local Bridge Verification after the fix: **PASS**.
- Current latest-head Node/bridge CI: pending final documentation commits.
- Unity 6000.3.21f1 compile/runtime for the hierarchy source: **Not yet verified**.
- Real MCP `unity_get_hierarchy` against live Unity: **Not yet verified**.

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
