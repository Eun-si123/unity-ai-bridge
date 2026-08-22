# CODEMAP

This file maps what exists in the repository and what is only planned.

**Rule:** a planned path is not implementation evidence. `STATUS.md` remains authoritative for implementation/verification state.

## Existing

```text
/
├─ .gitignore
├─ .nvmrc
├─ package.json
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
├─ llms.txt
│
├─ unity-package/
│  ├─ package.json
│  └─ Editor/
│     ├─ UnityAiBridge.Editor.asmdef
│     └─ Protocol/
│        └─ BridgeProtocol.cs
│
├─ bridge-protocol/
│  ├─ README.md
│  ├─ schemas/
│  │  ├─ command.v0.schema.json
│  │  └─ result.v0.schema.json
│  └─ fixtures/
│     ├─ editor-status.command.v0.json
│     └─ editor-status.result.v0.json
│
└─ mcp-server/
   ├─ package.json
   ├─ tsconfig.json
   ├─ src/
   │  ├─ index.ts
   │  └─ protocol/
   │     └─ bridge.ts
   └─ tests/
      └─ bridge-protocol.test.ts
```

The repository now has an initial source scaffold. It does **not** yet have a Unity WebSocket bridge, Unity command dispatcher, Unity tool handlers, remote gateway, provider integrations, or an end-to-end working MCP-to-Unity path.

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

## Current source ownership

### `unity-package/`

Current implementation:

- UPM package manifest,
- Editor-only assembly definition,
- bridge protocol/package version constants.

Planned expansion:

```text
Editor/
├─ Connection/
├─ Protocol/
├─ Commands/
├─ Dispatch/
├─ Tools/
├─ ObjectResolution/
├─ Compilation/
├─ Undo/
└─ Tests/
```

Unity API operations, networking, dispatcher behavior, Undo handling, and tool handlers are not implemented yet.

### `bridge-protocol/`

Current implementation:

- protocol v0 command JSON Schema,
- protocol v0 result JSON Schema,
- initial editor-status request/result fixtures,
- protocol documentation.

This contract is separate from MCP so Unity transport details and provider integrations do not define Unity command semantics.

### `mcp-server/`

Current implementation:

- pinned Node/TypeScript/MCP direct dependency configuration,
- strict TypeScript compiler configuration,
- minimal MCP v2 stdio server bootstrap,
- bridge v0 TypeScript envelope types,
- initial Node test-runner smoke tests.

Planned expansion:

```text
src/
├─ tools/
├─ protocol/
├─ validation/
├─ policy/
├─ routing/
├─ transport/
└─ errors/
```

No Unity bridge connection, public Unity tools, routing, remote HTTP endpoint, or auth policy implementation exists yet.

### Root build/configuration

- `.nvmrc` pins the initial Node runtime.
- root `package.json` delegates `build` and `test` to `mcp-server`.
- `.gitignore` excludes Node/TypeScript outputs and common generated Unity project data.

A dependency lockfile has not yet been generated.

## Planned top-level areas

These paths remain planned and must not be treated as existing:

```text
integrations/
├─ chatgpt/
├─ claude/
└─ other/

tests/
├─ protocol/
├─ integration/
└─ e2e/
```

Cross-layer tests should be added when there is an actual cross-layer path to verify rather than as empty placeholder directories.

## Private hosted infrastructure

`unity-ai-mcp-infra` is intended for managed-service composition/deployment: production auth/database/provider wiring, rate limits/abuse controls, monitoring, deployment pipelines, and private operations.

It should consume/deploy the public core rather than duplicate the core implementation.

## Updating this map

When a meaningful subsystem is added or moved:

1. inspect actual repository paths,
2. update this map,
3. update `STATUS.md` if implementation state changed,
4. update `DESIGN.md`/`DECISIONS.md` only if responsibilities/contracts changed,
5. never list a fictional path as existing merely because it appears in a plan.
