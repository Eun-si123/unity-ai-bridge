# CODEMAP

This file maps what exists in the repository and what is only planned.

**Rule:** a planned path below must not be treated as an existing implementation until it is actually present and `STATUS.md` is updated.

## Existing

```text
/
├─ README.md
├─ AGENTS.md
├─ STATUS.md
├─ ARCHITECTURE.md
├─ CODEMAP.md
├─ THIRD_PARTY_NOTICES.md
├─ CHANGELOG.md
└─ llms.txt
```

At this stage the repository contains documentation only. No Unity package, MCP server, gateway, or client integration source tree is implemented yet.

## Planned source layout

The following is a proposed layout, not current code:

```text
/
├─ unity-package/
│  ├─ package.json
│  ├─ Runtime/
│  └─ Editor/
│     ├─ Connection/
│     ├─ Commands/
│     ├─ Tools/
│     ├─ ObjectResolution/
│     ├─ Compilation/
│     └─ Tests/
│
├─ mcp-server/
│  ├─ src/
│  │  ├─ tools/
│  │  ├─ protocol/
│  │  ├─ validation/
│  │  └─ transport/
│  └─ tests/
│
├─ integrations/
│  ├─ chatgpt/
│  ├─ claude/
│  └─ other/
│
├─ docs/
└─ tests/
```

The actual layout may change after the runtime/language and Unity package architecture are selected.

## Ownership boundaries

### `unity-package/`

Target responsibility: code that runs inside Unity Editor and interacts with Unity APIs.

### `mcp-server/`

Target responsibility: MCP protocol/tool schemas, validation, transport, and structured result handling.

### `integrations/`

Target responsibility: thin client/provider-specific packaging or metadata. Provider-specific behavior should not leak into core Unity logic without a documented reason.

### hosted infrastructure

Production auth databases, secrets, deployment state, operational dashboards, and hosted-service internals should not be placed in this public repository by default.

## Updating this map

When adding or moving a meaningful subsystem:

1. update the tree,
2. describe its responsibility,
3. update `STATUS.md` if implementation status changed,
4. avoid listing fictional files merely because an architecture diagram mentions them.
