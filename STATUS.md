# Project Status

This file is the canonical source of truth for what is actually implemented and verified in **Unity AI Bridge**.

Do not infer implementation from README examples, architecture diagrams, issues, plans, or other Unity MCP projects.

## Status vocabulary

- **Planned** — no implementation should be assumed.
- **In progress** — partial/incomplete implementation exists.
- **Implemented** — code exists, but runtime behavior is not yet fully verified.
- **Verified** — reproduced with evidence on a named revision/environment.
- **Blocked** — progress is prevented by a named unresolved dependency/problem.

## Current phase

**Phase 0 — Repository bootstrap**

Overall status: **In progress**

### What exists now

| Area | Status | Evidence / notes |
|---|---|---|
| Public GitHub repository | Verified | Repository exists and accepts commits. |
| Project README | Implemented | Initial project scope and target direction documented. |
| AI/contributor guardrails | Implemented | `AGENTS.md` defines mandatory evidence and verification rules. |
| Architecture documentation | Implemented | `ARCHITECTURE.md` separates target design from implementation claims. |
| Code map | Implemented | `CODEMAP.md` separates existing paths from planned source layout. |
| Third-party provenance log | Implemented | `THIRD_PARTY_NOTICES.md` exists; no third-party implementation is recorded as incorporated. |
| Changelog | Implemented | `CHANGELOG.md` records bootstrap documentation changes. |
| AI quick-entry file | Implemented | `llms.txt` points agents to canonical rules/status documents. |
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
| ChatGPT plugin/app | Planned | Not implemented or submitted. |
| Claude/Gemini/other integrations | Planned | Not implemented. |
| BYO MCP routing | Planned | Not implemented. |

## Phase 0 exit criteria

Phase 0 is complete when:

- [x] architecture boundaries are documented,
- [x] public/private responsibilities are documented,
- [x] third-party provenance rules are established,
- [ ] initial source tree exists,
- [ ] development/runtime versions are intentionally selected,
- [ ] the first test strategy is documented,
- [x] no secret or production credential is intentionally committed in the bootstrap documentation.

## Phase 1 target — Minimal local end-to-end path

Phase 1 will attempt to prove one narrow path:

```text
MCP client
   -> MCP server
   -> Unity transport
   -> Unity main-thread command execution
   -> Unity API
   -> structured result
```

Proposed minimum capabilities:

- editor/status query,
- active scene query,
- hierarchy query,
- create a simple GameObject,
- read Console/compiler errors.

These are **targets, not current features**.

## Verification log

No Unity/MCP runtime verification has been performed yet.

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

## Known unknowns

The following decisions are intentionally unresolved and must not be guessed:

- final project license,
- final Unity version support matrix,
- MCP SDK/runtime/language selection,
- transport between remote gateway and Unity,
- public hosting provider,
- ChatGPT plugin submission details/capability availability,
- authentication/pairing implementation,
- BYO MCP security model,
- which third-party implementations, if any, will contribute reusable code.

Update this section when a decision is made with evidence.
