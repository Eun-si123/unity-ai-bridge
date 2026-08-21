# CODEMAP

This file maps what exists in the repository and what is only planned.

**Rule:** a planned path below must not be treated as an existing implementation until it is actually present and `STATUS.md` is updated.

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
├─ THIRD_PARTY_NOTICES.md
├─ CHANGELOG.md
└─ llms.txt
```

At this stage the repository contains documentation only. No Unity package, MCP server, bridge protocol source, gateway, or client integration source tree is implemented yet.

## Documentation responsibilities

### `STATUS.md`

Canonical answer to: **What is actually implemented and verified?**

### `DESIGN.md`

Durable detailed system design / memory anchor. Records intended behavior such as transport layering, command dispatch, retries, reconnect, object identity, Undo, routing, and testing.

### `DECISIONS.md`

Architecture decision history and rationale. Accepted decisions should not be silently reversed.

### `ROADMAP.md`

Public capability phases and exit gates. Roadmap items are not implementation evidence.

### `ARCHITECTURE.md`

High-level architecture principles and subsystem boundaries.

### `AGENTS.md`

Mandatory rules for AI agents and contributors.

## Planned source layout

The following is the current target layout, not current code:

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

The exact file/folder names may change during Phase 0 scaffolding. If they change, update this map and record any meaningful architecture change in `DECISIONS.md`.

## Planned ownership boundaries

### `unity-package/`

Target responsibility: code that runs inside Unity Editor and interacts with Unity APIs.

Expected major responsibilities:

- outbound/local connection lifecycle,
- command queue and main-thread dispatcher,
- object resolution,
- Unity tool handlers,
- Undo and dirty-state reporting,
- compile/domain-reload watcher,
- Unity-side tests.

### `bridge-protocol/`

Target responsibility: explicit versioned Unity-facing command/result schemas and fixtures shared conceptually by both sides.

The protocol is separate from MCP so Unity transport details can evolve without redefining public tool semantics.

### `mcp-server/`

Target responsibility: MCP protocol/tool schemas, validation, risk policy, routing, transport adaptation, request/result correlation, and structured errors.

Initial design direction is TypeScript with the official MCP TypeScript SDK v2 line. This is a design decision, not evidence that dependencies have been installed.

### `integrations/`

Target responsibility: thin provider/client-specific packaging or metadata. Provider-specific behavior should not leak into core Unity logic without a documented reason.

### `tests/`

Target responsibility: cross-layer protocol/integration/end-to-end verification that does not fit naturally inside one package.

### hosted infrastructure

Production auth databases, secrets, deployment state, operational dashboards, production-only administration, and hosted-service internals belong in the separate private infrastructure repository by default.

The private repository should consume/deploy the public core rather than maintain a second private copy of core behavior.

## Updating this map

When adding or moving a meaningful subsystem:

1. inspect actual repository paths,
2. update this tree,
3. describe the responsibility,
4. update `STATUS.md` if implementation status changed,
5. update `DESIGN.md`/`DECISIONS.md` if architecture changed,
6. avoid listing fictional files merely because a design diagram mentions them.
