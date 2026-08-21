# CODEMAP

This file maps what exists in the repository and what is only planned.

**Rule:** a planned path is not implementation evidence. `STATUS.md` remains authoritative for implementation/verification state.

## Existing

```text
/
├─ README.md
├─ AGENTS.md
├─ STATUS.md
├─ DESIGN.md
├─ DECISIONS.md
├─ ROADMAP.md
├─ ARCHITECTURE.md
├─ CODEMAP.md
├─ REFERENCES.md
├─ CHANGELOG.md
└─ llms.txt
```

At this stage the repository contains documentation only. No Unity package, MCP/server runtime, bridge protocol source, gateway runtime, or client integration source tree exists yet.

## Documentation responsibilities

- `STATUS.md` — what is actually implemented and verified
- `DESIGN.md` — durable detailed design / memory anchor
- `DECISIONS.md` — architecture decision history and rationale
- `ROADMAP.md` — public phases and exit gates
- `ARCHITECTURE.md` — concise high-level boundaries
- `AGENTS.md` — mandatory AI/contributor rules
- `REFERENCES.md` — external research references; not proof of code reuse
- `CHANGELOG.md` — notable project changes
- `llms.txt` — compact AI entrypoint

## Planned source layout

The following is the current target, not current code:

```text
/
├─ unity-package/
│  ├─ package.json
│  ├─ Editor/
│  │  ├─ Connection/
│  │  ├─ Protocol/
│  │  ├─ Commands/
│  │  ├─ Dispatch/
│  │  ├─ Tools/
│  │  ├─ ObjectResolution/
│  │  ├─ Compilation/
│  │  ├─ Undo/
│  │  └─ Tests/
│  └─ Documentation~/
│
├─ bridge-protocol/
│  ├─ schemas/
│  ├─ fixtures/
│  └─ README.md
│
├─ mcp-server/
│  ├─ package.json
│  ├─ src/
│  │  ├─ tools/
│  │  ├─ protocol/
│  │  ├─ validation/
│  │  ├─ policy/
│  │  ├─ routing/
│  │  ├─ transport/
│  │  └─ errors/
│  └─ tests/
│
├─ integrations/
│  ├─ chatgpt/
│  ├─ claude/
│  └─ other/
│
└─ tests/
   ├─ protocol/
   ├─ integration/
   └─ e2e/
```

Exact paths may change during Phase 0 scaffolding. Routine folder-name adjustments do not need an architecture decision unless they change subsystem ownership or contracts.

## Planned ownership boundaries

### `unity-package/`

Unity Editor-side implementation:

- connection lifecycle,
- command queue/main-thread dispatcher,
- target/object resolution,
- Unity tool handlers,
- Undo/dirty-state handling,
- compile/domain-reload lifecycle,
- Unity-side tests.

### `bridge-protocol/`

Explicit, versioned Unity-facing command/result schemas and fixtures. This contract is separate from MCP so Unity transport details can evolve without redefining every public tool semantic.

### `mcp-server/`

Provider-neutral MCP/server core:

- MCP tool schemas,
- validation/risk policy,
- bridge adaptation,
- request/result correlation,
- reusable routing abstractions,
- structured errors,
- local/self-host behavior.

Initial design direction is TypeScript with the official MCP TypeScript SDK v2 line. No dependency/runtime code exists yet.

### `integrations/`

Thin provider/client-specific metadata/adapters. Provider-specific behavior should not leak into Unity command logic without a documented interoperability reason.

### `tests/`

Cross-layer protocol/integration/end-to-end verification that does not naturally belong to one package.

### Private hosted infrastructure

`unity-ai-mcp-infra` is intended for managed-service composition/deployment: production auth/database/provider wiring, rate limits/abuse controls, monitoring, deployment pipelines, and private operations.

It should consume/deploy the public core rather than duplicate the core implementation.

## Updating this map

When a meaningful subsystem is added or moved:

1. inspect actual repository paths,
2. update this map,
3. update `STATUS.md` if implementation state changed,
4. update `DESIGN.md`/`DECISIONS.md` only if responsibilities/contracts changed,
5. never list a fictional path as existing merely because it appears in a plan.
