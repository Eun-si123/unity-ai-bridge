# Project Status

Canonical source of truth for what is actually implemented and verified in **Unity AI Bridge**.

Do not infer implementation from README examples, design diagrams, decisions, roadmaps, issues, plans, or other Unity MCP projects.

## Status vocabulary

- **Planned** — desired, no implementation should be assumed.
- **In progress** — partial/incomplete implementation exists.
- **Implemented** — implementation exists but relevant runtime behavior may still be unverified.
- **Verified** — reproduced with evidence on a named revision/environment.
- **Blocked** — progress is prevented by a named unresolved dependency/problem.

Design choices are tracked separately as **Proposed / Accepted / Superseded / Rejected** in `DECISIONS.md`. Do not label a design choice `Implemented` merely because it is documented.

## Current phase

**Phase 0 — Foundation / repository bootstrap**  
Overall status: **In progress**

## What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| README / project overview | Implemented | Scope, intended UX, repository split, and documentation map exist. |
| AI/contributor rules | Implemented | `AGENTS.md`. |
| Detailed design baseline | Implemented | `DESIGN.md`; design is not runtime verification. |
| Architecture decision record | Implemented | `DECISIONS.md`. |
| Public roadmap | Implemented | `ROADMAP.md`. |
| Code/repository map | Implemented | `CODEMAP.md`. |
| External research references | Implemented | `REFERENCES.md`; no listed Unity MCP implementation is recorded as copied into this project. |
| Unity Editor package scaffold | Implemented | `unity-package/package.json`, Editor asmdef, and protocol constants exist. Not yet loaded/compiled in Unity. |
| Initial Unity target | Implemented | Package manifest pins minimum target to Unity `6000.3` + `21f1` (6000.3.21f1). Broader compatibility is unverified. |
| Bridge protocol v0 source contract | Implemented | Command/result JSON Schemas, fixtures, C# version constant, and TypeScript types exist. No transport compatibility verification yet. |
| MCP/server scaffold | Implemented | TypeScript stdio MCP bootstrap source exists using `@modelcontextprotocol/server` 2.0.0. Dependencies have not been installed or built in recorded verification yet. |
| Node runtime pin | Implemented | `.nvmrc` pins Node 24.19.0; package engines constrain Node 24.x from 24.19.0. |
| Direct TypeScript dependency pins | Implemented | MCP server 2.0.0, TypeScript 7.0.2, and `@types/node` 24.13.3 are exact direct pins. No lockfile exists yet, so transitive dependency resolution is not frozen. |
| Initial automated check commands | Implemented | Root/server `build` and `test` scripts plus Node test-runner smoke tests exist. They have not yet been recorded as passing. |
| Unity bridge transport | Planned | No WebSocket transport implementation exists. |
| Unity status/scene/hierarchy tools | Planned | Not implemented. |
| GameObject mutation tools | Planned | Not implemented. |
| Console/compiler tools | Planned | Not implemented. |
| Main-thread dispatcher / command queue | Planned | Not implemented. |
| Undo integration | Planned | Not implemented. |
| Script editing | Planned | Not implemented. |
| Play Mode / Test Runner integration | Planned | Not implemented. |
| Remote gateway / Easy Connect | Planned | Not implemented. |
| Pairing/authentication | Planned | Not implemented. |
| Multi-user/editor routing | Planned | Not implemented. |
| ChatGPT integration | Planned | Not implemented or submitted. |
| Claude/Gemini/other integrations | Planned | Not implemented. |
| BYO MCP mode | Planned | Not implemented; may never ship. |

## Accepted design decisions — not implementation claims

The following directions are accepted in `DECISIONS.md`:

- provider-neutral core,
- public core + separate private managed-service infrastructure,
- Unity-side C# Editor package,
- TypeScript initial MCP/server core,
- official MCP TypeScript SDK v2 direction,
- Streamable HTTP for remote MCP,
- transport-independent Unity bridge protocol with WebSocket first,
- Unity main-thread command queue,
- small stable tool surface before large tool count,
- no arbitrary C# execution as an early default escape hatch,
- request identity / ambiguous-retry protection,
- durable target resolution instead of `InstanceID` alone,
- domain reload/reconnection as normal lifecycle,
- Undo and dirty-state reporting as core behavior,
- Easy Connect after the local reliability core,
- TeamForge is not an early dependency.

## Phase 0 exit criteria

- [x] repository roles/boundaries documented
- [x] AI/contributor grounding rules documented
- [x] detailed design baseline documented
- [x] architecture decisions recorded
- [x] public roadmap documented
- [x] external-reference/code-reuse rules documented
- [x] initial source tree exists
- [x] initial Unity support target selected and pinned
- [ ] dependency graph fully pinned with a generated lockfile
- [x] bridge protocol v0 schema exists in source
- [x] initial test strategy documented in `DESIGN.md`
- [x] executable initial test/check commands exist
- [ ] initial dependency install/build/test commands recorded as passing
- [ ] Unity package load/compile check recorded as passing
- [ ] project license selected
- [x] no real secret or production credential intentionally committed in foundation files

## Phase 1 target — Minimal local end-to-end path

```text
MCP client
   -> public MCP/server core
   -> Unity bridge transport
   -> Unity command queue
   -> Unity main thread
   -> Unity API
   -> structured result
   -> state re-read verifies the effect
```

Target minimum capabilities:

- editor/status query,
- active scene query,
- hierarchy query,
- create a simple GameObject,
- read Console/compiler errors,
- structured error output,
- request IDs and write retry protection.

These are **targets, not current features**.

## Verification log

No dependency install, TypeScript build/test, Unity package load/compile, or MCP-to-Unity runtime verification has been recorded yet for the scaffold branch.

Future verification entries should include:

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

## Known unknowns

Do not guess these until intentionally decided/verified:

- project license,
- long-term Unity support matrix beyond the initial 6000.3.21f1 target,
- generated lockfile/transitive dependency resolution,
- exact Unity WebSocket/client implementation,
- bridge v0 compatibility/migration policy beyond the initial pre-stable schema,
- public hosting provider,
- ChatGPT integration/submission requirements when that phase begins,
- authentication/pairing cryptography and credential storage,
- managed-service database/identity provider,
- BYO MCP security model and whether it will ship,
- whether any third-party implementation code will ever be incorporated.
