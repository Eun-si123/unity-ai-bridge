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

Phase 0 was squash-merged to `main` on 2026-08-22. Its Node/MCP checks are verified. The public repository license is **Apache License 2.0**. Unity 6000.3.21f1 package compilation and the real local WebSocket `hello -> editor.status -> structured result` path are now manually verified. A real MCP `unity_get_status` call and domain-reload/restart reconnection verification remain open.

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Public-core license | Implemented | Root `LICENSE` is Apache License 2.0. The separate private `unity-ai-mcp-infra` repository is outside this repository's automatic license boundary. |
| Core design/docs | Implemented | `AGENTS.md`, `DESIGN.md`, `DECISIONS.md`, `ROADMAP.md`, `CODEMAP.md`, `REFERENCES.md`. |
| Unity Editor package scaffold | Verified manually | Package Manager load and Unity AI Bridge Editor assembly compilation passed in Unity 6000.3.21f1 on Windows at revision `059727365c025eb1d18013371fe95e055517e570`. |
| Initial Unity target | Verified for current Phase 1 slice | Unity 6000.3.21f1 compiled the package and completed a real WebSocket/status round trip. Broader compatibility remains unverified. |
| Bridge protocol v0 | Implemented | Command/result schemas plus v0 hello schema, TypeScript types, C# protocol version, and fixtures/source contracts. |
| MCP/server scaffold | Verified | Phase 0 Node 24.19.0 install/build/tests passed in Actions run `32562797071`. |
| Phase 1 dependency lockfile | Verified | `mcp-server/package-lock.json` includes exact `ws` 8.21.3 and `@types/ws` 8.18.1 pins and is consumed by passing Phase 1 CI. |
| Local WebSocket bridge server | Verified manually + CI | Node simulation passes, and a real Unity 6000.3.21f1 Editor connected to `127.0.0.1:5081`, sent protocol v0 `hello`, received `editor.status`, and returned a valid result at revision `059727365c025eb1d18013371fe95e055517e570`. |
| Unity outbound WebSocket connection | Verified manually | Real `ClientWebSocket` connection and hello succeeded on Windows / Unity 6000.3.21f1. |
| Unity main-thread dispatcher | Verified for `editor.status` path | The real status request completed through the dispatcher-backed handler and returned live Editor state. |
| `editor.status` bridge operation | Verified manually | Returned Unity `6000.3.21f1`, active scene `Assets/Scenes/SampleScene.unity`, `isPlaying=false`, and `isCompiling=false` from the real test Editor. |
| MCP `unity_get_status` | Implemented | Tool routes through the local bridge and only succeeds after a matching validated Unity result. A real MCP protocol call against live Unity is still pending. |
| Node local-bridge integration tests | Verified | Protocol tests, simulated Unity hello/status round-trip, and no-editor failure pass under Node 24.19.0; current CI remains green. |
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
- [x] Unity package compiles in 6000.3.21f1
- [x] real Unity hello observed by local bridge
- [x] real bridge `editor.status` result observed and matched live Editor state
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
Revision under test: 059727365c025eb1d18013371fe95e055517e570
Environment: Windows, Unity 6000.3.21f1
Action: Package Manager -> Add package from disk -> unity-package/package.json -> compile/domain reload
Expected: package loads and Unity AI Bridge Editor assembly compiles with zero compile errors
Observed: user reported no errors
Result: PASS (manual user verification)
```

### 2026-08-22 — Real Unity local bridge/status round trip

```text
Revision under test: 059727365c025eb1d18013371fe95e055517e570
Environment: Windows, Unity 6000.3.21f1, Node 24.x Phase 1 verifier
Action: npm.cmd --prefix mcp-server run verify:unity
Expected: local bridge listens on 127.0.0.1:5081; real Unity sends protocol v0 hello; bridge sends editor.status; Unity returns current Editor state
Observed: hello received with unityVersion=6000.3.21f1 and a valid editorId/connectionGeneration; editor.status PASS returned activeScene=Assets/Scenes/SampleScene.unity, isPlaying=false, isCompiling=false
Result: PASS
Notes: this verifies the real WebSocket/Unity command path, but the verifier calls LocalBridgeServer directly rather than invoking the MCP tool over MCP stdio.
```

## Known unknowns

- long-term Unity support matrix beyond 6000.3.21f1,
- real MCP stdio `unity_get_status` behavior against the live Unity Editor,
- domain reload/restart reconnection behavior and stale-generation rejection in a real Editor,
- future multi-editor routing design,
- remote authentication/pairing cryptography,
- public hosting provider,
- ChatGPT integration/submission requirements at implementation time,
- BYO MCP security model and whether it will ship.
