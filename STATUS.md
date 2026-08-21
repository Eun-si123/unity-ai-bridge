# Project Status

This file is the canonical source of truth for what is actually implemented and verified in **Unity AI Bridge**.

Do not infer implementation from README examples, architecture/design diagrams, decisions, roadmaps, issues, plans, or other Unity MCP projects.

## Status vocabulary

- **Planned** — no implementation should be assumed.
- **In progress** — partial/incomplete implementation exists.
- **Implemented** — code or documentation exists, but runtime behavior is not yet fully verified where runtime verification applies.
- **Verified** — reproduced with evidence on a named revision/environment.
- **Blocked** — progress is prevented by a named unresolved dependency/problem.

## Current phase

**Phase 0 — Foundation / repository bootstrap**

Overall status: **In progress**

### What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Project README | Implemented | Scope, intended UX, repository boundaries, and document map are documented. |
| AI/contributor guardrails | Implemented | `AGENTS.md` defines mandatory evidence, design-history, verification, security, and licensing rules. |
| Architecture documentation | Implemented | `ARCHITECTURE.md` separates target architecture from implementation claims. |
| Detailed design baseline | Implemented | `DESIGN.md` records the intended execution, transport, retry, reconnect, identity, Undo, routing, and testing model. |
| Architecture decision record | Implemented | `DECISIONS.md` records accepted design choices and how to supersede them. |
| Public roadmap | Implemented | `ROADMAP.md` defines capability phases and exit gates without invented ETAs. |
| Code map | Implemented | `CODEMAP.md` separates existing paths from planned source layout. |
| Third-party provenance log | Implemented | `THIRD_PARTY_NOTICES.md` exists; no third-party implementation is recorded as incorporated. |
| Changelog | Implemented | `CHANGELOG.md` records bootstrap documentation changes. |
| AI quick-entry file | Implemented | `llms.txt` points agents to canonical rules/status/design documents. |
| Initial MCP/server language direction | Implemented (design only) | TypeScript + official MCP TypeScript SDK v2 line is accepted in `DECISIONS.md`; no server source exists yet. |
| Remote MCP transport direction | Implemented (design only) | Streamable HTTP is accepted as the remote MCP direction; no endpoint exists yet. |
| Unity bridge transport direction | Implemented (design only) | Transport abstraction + WebSocket first is accepted; no transport code exists yet. |
| Unity Editor package | Planned | No working package should be assumed. |
| MCP server | Planned | No working MCP endpoint should be assumed. |
| Unity connection/transport | Planned | No working transport should be assumed. |
| Unity status tool | Planned | Not implemented. |
| Scene/hierarchy read tools | Planned | Not implemented. |
| GameObject mutation tools | Planned | Not implemented. |
| Console/compiler read tools | Planned | Not implemented. |
| Undo integration | Planned | Not implemented. |
| Script editing | Planned | Not implemented. |
| Play Mode control | Planned | Not implemented. |
| Unity Test Runner integration | Planned | Not implemented. |
| Remote gateway | Planned | Not implemented. |
| Pairing/authentication | Planned | Not implemented. |
| Multi-user routing | Planned | Not implemented. |
| ChatGPT plugin/app integration | Planned | Not implemented or submitted. |
| Claude/Gemini/other integrations | Planned | Not implemented. |
| BYO MCP routing | Planned | Not implemented. |

## Phase 0 exit criteria

Phase 0 is complete when:

- [x] architecture boundaries are documented,
- [x] durable detailed design is documented,
- [x] architecture decisions are recorded with rationale,
- [x] public roadmap and capability gates are documented,
- [x] public/private responsibilities are documented,
- [x] third-party provenance rules are established,
- [ ] initial source tree exists,
- [ ] initial Unity support target is intentionally selected and pinned,
- [ ] exact development/runtime versions are pinned in source/configuration,
- [ ] bridge protocol v0 schema exists in source,
- [x] initial test strategy is documented in `DESIGN.md`,
- [ ] initial executable test/check commands exist,
- [ ] project license is selected,
- [x] no secret or production credential is intentionally committed in the bootstrap documentation.

## Phase 1 target — Minimal local end-to-end path

Phase 1 will attempt to prove one narrow path:

```text
MCP client
   -> public MCP server
   -> Unity bridge transport
   -> Unity command queue
   -> Unity main-thread command execution
   -> Unity API
   -> structured result
   -> state re-read verifies the effect
```

Proposed minimum capabilities:

- editor/status query,
- active scene query,
- hierarchy query,
- create a simple GameObject,
- read Console/compiler errors,
- structured error output,
- request IDs and write retry protection.

These are **targets, not current features**.

See `ROADMAP.md` for later phase gates.

## Verification log

No Unity/MCP runtime verification has been performed yet because no runtime implementation exists.

When verification begins, add entries in this format:

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

## Accepted design facts that are NOT implementation facts

The following are accepted directions recorded in `DECISIONS.md`, but no working code should be inferred from them:

- provider-neutral core,
- public open core + private hosted operations,
- Unity-side C# Editor package,
- TypeScript initial MCP/server core,
- official MCP TypeScript SDK v2 direction,
- Streamable HTTP for remote MCP,
- transport-independent Unity bridge protocol with WebSocket first,
- main-thread Unity command queue,
- small stable tool surface before large tool count,
- no arbitrary C# execution in the early public core,
- request identity/ambiguous-retry protection,
- stable object resolution instead of InstanceID-only identity,
- domain reload/reconnection as normal lifecycle,
- Undo and dirty-state reporting as core behavior,
- Easy Connect as the product UX target after the local reliability core,
- TeamForge is not an early dependency.

## Known unknowns

The following decisions are intentionally unresolved and must not be guessed:

- final project license,
- initial and long-term Unity version support matrix,
- exact Node/runtime minimum version,
- exact dependency versions until package manifests/lockfiles exist,
- exact bridge protocol v0 JSON/schema field names,
- exact WebSocket library/client implementation on the Unity side,
- public hosting provider,
- current ChatGPT plugin/app submission details at the time integration begins,
- exact authentication/pairing cryptography and credential storage,
- database/identity provider for the managed service,
- BYO MCP security model and whether that mode will ship,
- which third-party implementations, if any, will contribute reusable code.

Update this section when a decision is made with repository evidence. Significant architecture changes must also update `DECISIONS.md` rather than silently rewriting history.
