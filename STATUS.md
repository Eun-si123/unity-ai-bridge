# Project Status

Canonical source of truth for what is actually implemented and verified in **Unity AI Bridge**.

Do not infer implementation from README examples, design diagrams, decisions, roadmaps, issues, plans, or other Unity MCP projects.

## Status vocabulary

- **Planned** — desired, no implementation should be assumed.
- **In progress** — partial/incomplete implementation exists.
- **Implemented** — implementation exists but relevant runtime behavior may still be unverified.
- **Verified** — reproduced with evidence on a named revision/environment.
- **Blocked** — progress is prevented by a named unresolved dependency/problem.

## Current phase

**Phase 1 — Minimal local end-to-end**  
Overall status: **In progress**

Phase 0 was squash-merged to `main` on 2026-08-22. Its Node/MCP checks are verified. The public repository license is now **Apache License 2.0**. A manual Unity 6000.3.21f1 package load/compile check has now passed; real WebSocket/MCP runtime verification remains open.

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Core design/docs | Implemented | `AGENTS.md`, `DESIGN.md`, `DECISIONS.md`, `ROADMAP.md`, `CODEMAP.md`, `REFERENCES.md`. |
| Unity Editor package scaffold | Verified manually | User reported successful Package Manager load and zero Unity AI Bridge compile errors in Unity 6000.3.21f1 on 2026-08-22. Exact local checkout SHA was not captured. |
| Initial Unity target | Verified for compile | Unity 6000.3.21f1 loaded and compiled the current package in the manual check. Broader compatibility remains unverified. |
| Bridge protocol v0 | Implemented | Command/result schemas plus v0 hello schema, TypeScript types, C# protocol version, and fixtures/source contracts. |
| MCP/server scaffold | Verified | Phase 0 Node 24.19.0 install/build/tests passed in Actions run `32562797071`. |
| Phase 1 dependency lockfile | Verified | `mcp-server/package-lock.json` includes exact `ws` 8.21.3 and `@types/ws` 8.18.1 pins and was successfully consumed by Phase 1 CI. |
| Local WebSocket bridge server | Verified in Node simulation | `LocalBridgeServer` binds to `127.0.0.1:5081`, tracks one active editor, routes request IDs/deadlines/disconnects, and completed simulated hello -> `editor.status` -> result round trips. Real Unity peer still unverified. |
| Unity outbound WebSocket connection | Implemented | `ClientWebSocket` connection/reconnect loop, hello, route-generation validation, bounded message receive, and serialized sends exist. Unity runtime verification pending. |
| Unity main-thread dispatcher | Implemented | Network path can marshal Unity API work through `EditorMainThreadDispatcher`. Unity runtime verification pending. |
| `editor.status` bridge operation | Implemented | Reads Unity version, project, active scene, Play Mode and compilation state on the Editor main thread. Real Unity runtime verification pending. |
| MCP `unity_get_status` | Implemented | Tool routes through the local bridge and only succeeds after a matching validated Unity result. MCP-to-real-Unity verification pending. |
| Node local-bridge integration tests | Verified | Protocol tests, simulated Unity hello/status round-trip, and no-editor failure passed under Node 24.19.0; current pre-license-rebase Phase 1 runs `32564186863` and `32564186926` passed at revision `5417d25d50d7617bc1df0e9ee82c367cd97f3344`. |
| GameObject mutation tools | Planned | Not implemented. |
| Console/compiler tools beyond status | Planned | Not implemented. |
| Undo integration | Planned | Not implemented. |
| Remote gateway / Easy Connect | Planned | Not implemented. |
| Pairing/authentication | Planned | Not implemented. |
| Multi-user/editor routing | Planned | Local bridge intentionally supports one active editor only. |
| ChatGPT integration | Planned | Not implemented or submitted. |

## Phase 0 exit criteria

Phase 0 implementation was merged because the scaffold is useful as the stable development baseline. Unchecked items remain explicitly unverified rather than silently waived.

- [x] repository roles/boundaries documented
- [x] AI/contributor grounding rules documented
- [x] detailed design baseline documented
- [x] architecture decisions recorded
- [x] public roadmap documented
- [x] external-reference/code-reuse rules documented
- [x] initial source tree exists
- [x] initial Unity support target selected and pinned
- [x] Phase 0 dependency graph pinned with generated lockfile
- [x] bridge protocol v0 schema exists in source
- [x] executable initial test/check commands exist
- [x] Phase 0 dependency install/build/test recorded as passing
- [x] Unity package load/compile check recorded as passing
- [x] project license selected: Apache-2.0

## Phase 1 implementation target

```text
MCP unity_get_status
   -> MCP/server core
   -> local WebSocket bridge
   -> Unity outbound connection
   -> Unity main-thread dispatcher
   -> editor.status
   -> structured result
   -> MCP result
```

Current narrow slice:

- [x] local bridge design documented
- [x] v0 hello contract implemented
- [x] local WebSocket server source implemented
- [x] Unity outbound connection/reconnect source implemented
- [x] Unity main-thread dispatcher source implemented
- [x] `editor.status` source implemented
- [x] MCP `unity_get_status` source implemented
- [x] simulated Unity Node integration tests implemented
- [x] Phase 1 Node build/tests recorded as passing
- [x] Unity package compiles in 6000.3.21f1 (manual user verification; exact local SHA not captured)
- [ ] real Unity hello observed by local bridge
- [ ] real MCP `unity_get_status` result observed
- [ ] domain reload/restart reconnection verified with new connection generation

The rest of the Phase 1 minimum (hierarchy, GameObject create, Console/compiler read) remains planned after this narrow status path is proven.

## Verification log

### 2026-08-22 — Node/MCP Phase 0 scaffold

```text
Revision under test: 246ac56c5f62ba44e4546cc7185e5de751e72fa8
Environment: GitHub Actions ubuntu-24.04, Node 24.19.0, npm 11.17.0
Action: generate lockfile -> npm ci -> npm run build -> npm test
Observed: all verification steps completed successfully in Actions run 32562797071
Result: PASS
```

### 2026-08-22 — Phase 1 local bridge simulation

```text
Revision under test: 5417d25d50d7617bc1df0e9ee82c367cd97f3344
Environment: GitHub Actions ubuntu-24.04, Node 24.19.0
Action: refresh/generate lockfile -> npm ci -> TypeScript build -> all Node tests
Expected: protocol tests pass; simulated Unity WebSocket peer can hello, receive editor.status, return a matching result; no-editor request fails explicitly
Observed: Node Verification run 32564186863 and Phase 1 Local Bridge Verification run 32564186926 completed successfully
Result: PASS
Notes: earlier CI exposed and fixed a real ws callback contract bug where successful sends may report `null` rather than `undefined`.
```

### 2026-08-22 — Unity package load/compile

```text
Revision under test: exact local checkout SHA not captured
Environment: Windows, Unity 6000.3.21f1
Action: open clean project -> Package Manager -> Add package from disk -> select unity-package/package.json -> allow compilation/domain reload
Expected: package loads and Unity AI Bridge Editor assembly compiles with zero compile errors
Observed: user reported steps 1-3 completed with no errors
Result: PASS (manual user verification)
Notes: runtime WebSocket connection and MCP end-to-end behavior were not part of this check.
```

No real Unity WebSocket connection or MCP-to-Unity runtime verification has been recorded yet.

## Known unknowns

- long-term Unity support matrix beyond 6000.3.21f1,
- actual Unity 6000.3.21f1 `ClientWebSocket` runtime behavior,
- future multi-editor routing design,
- remote authentication/pairing cryptography,
- public hosting provider,
- ChatGPT integration/submission requirements at implementation time,
- BYO MCP security model and whether it will ship.
