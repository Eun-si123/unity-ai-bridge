# CODEMAP

This file maps the current repository at subsystem level and records what is only planned.

**Rule:** a planned path is not implementation evidence. `STATUS.md` remains authoritative for implementation/verification state. This map intentionally avoids enumerating every command/test file so it does not become stale after every Phase 3 slice.

## Current top-level source tree

```text
/
├─ .github/workflows/
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
├─ docs/
│  ├─ TESTING.md
│  └─ OPEN_WEIGHT_MODEL_COMPATIBILITY.md
│
├─ unity-package/
│  ├─ package.json
│  ├─ Editor/
│  │  ├─ AssemblyInfo.cs
│  │  ├─ UnityAiBridge.Editor.asmdef
│  │  ├─ Commands/
│  │  ├─ Connection/
│  │  ├─ Dispatch/
│  │  ├─ Execution/
│  │  ├─ Protocol/
│  │  └─ Testing/
│  │     ├─ PackageTestBootstrap.cs
│  │     └─ TestRunnerControl.cs
│  └─ Tests/
│     ├─ README.md
│     └─ Editor/
│        ├─ UnityAiBridge.Editor.Tests.asmdef
│        ├─ Fixtures/
│        └─ *Tests.cs
│
├─ bridge-protocol/
│  ├─ README.md
│  ├─ PREFAB_PROPERTY_APPLY.md
│  ├─ SCRIPT_READ.md
│  ├─ TEST_RUNNER_CONTROL.md
│  ├─ schemas/
│  └─ fixtures/
│
└─ mcp-server/
   ├─ package.json
   ├─ package-lock.json
   ├─ tsconfig.json
   ├─ src/
   │  ├─ index.ts
   │  ├─ agent/
   │  ├─ bridge/
   │  │  ├─ script-bridge-server.ts
   │  │  └─ prefab-property-bridge-server.ts
   │  ├─ protocol/
   │  ├─ dev/
   │  ├─ asset-tools.ts
   │  ├─ script-tools.ts
   │  ├─ component-tools.ts
   │  ├─ gameobject-edit-tools.ts
   │  ├─ prefab-property-tools.ts
   │  ├─ test-runner-tools.ts
   │  └─ additional domain/tool modules
   └─ tests/
```

## Documentation responsibilities

- `STATUS.md` — actual implementation and verification state
- `DESIGN.md` — durable detailed design / memory anchor
- `DECISIONS.md` — architecture decision history and rationale
- `ROADMAP.md` — public phases and exit gates
- `ARCHITECTURE.md` — concise high-level boundaries
- `AGENTS.md` — mandatory AI/contributor rules
- `REFERENCES.md` — external research references; not proof of code reuse
- `CHANGELOG.md` — notable project changes
- `docs/TESTING.md` and package test docs — repeatable verification procedures
- `docs/OPEN_WEIGHT_MODEL_COMPATIBILITY.md` — deferred local/open-weight compatibility boundary and future Adaptive Router direction
- `bridge-protocol/SCRIPT_READ.md` — bounded Script source observation contract and future file-content CAS boundary
- `bridge-protocol/TEST_RUNNER_CONTROL.md` — bounded asynchronous EditMode Test Runner start/get contract, retry identity, current-session journaling, and result bounds
- `llms.txt` — compact AI entrypoint

## Current source ownership

### `unity-package/`

Home of the Unity Editor-side implementation:

- Editor-only UPM assembly,
- outbound local WebSocket connection/reconnect lifecycle,
- versioned bridge hello/command/result handling,
- explicit connection generations and stale-generation rejection,
- main-thread dispatch,
- state epoch/revision tracking and stale-state protection,
- mutation lifecycle/replay protection,
- common mutation transaction behavior,
- Undo/dirty-state handling,
- semantic native readback and rollback verification where applicable,
- Editor status/hierarchy/diagnostics/object resolution,
- Phase 3 Transform, GameObject, Component, Asset, Script, Prefab, Play Mode, and Test Runner handlers,
- bounded Script source reading through Unity asset/package identity rather than arbitrary filesystem paths,
- persistent Prefab asset-write handlers with operation-specific safety/retry semantics where generic Unity Undo is not honestly available,
- asynchronous EditMode Test Runner coordination through public Unity Test Framework APIs plus current-process SessionState result journals,
- EditMode tests and live/manual verifiers,
- development-install bootstrap for making non-embedded package tests visible in Unity Test Runner.

`STATUS.md` records which slices are Verified and which later changes are only Implemented.

### `bridge-protocol/`

The Unity-facing transport-independent contract:

- protocol-versioned command/hello/result JSON Schemas,
- operation fixtures,
- bridge protocol documentation,
- operation-specific contracts such as bounded Prefab property apply, Script source read, and asynchronous EditMode Test Runner control.

MCP-facing tool contracts and Unity-facing bridge commands remain separate on purpose. Unity command semantics must not depend on a particular LLM vendor, MCP host, or WebSocket-specific detail.

### `mcp-server/`

The provider-neutral MCP/tool layer:

- official MCP TypeScript SDK v2 server,
- local stdio MCP bootstrap,
- local loopback WebSocket bridge,
- request/result correlation and route-generation handling,
- capability preflight,
- tool schemas/descriptions,
- typed bridge adapters for current Unity domains,
- bounded Script read tool/bridge adapter with raw-file SHA-256 metadata,
- asynchronous EditMode Test Runner start/get tools with exact selection and bounded structured result validation,
- domain-specific bridge subclasses/modules where that keeps large surfaces maintainable,
- structured MCP results/errors,
- simulated bridge tests and real-Unity verification helpers.

Current MCP tools cover the verified/implemented Phase 3 surface summarized in `STATUS.md`; exact tool names live in source rather than being duplicated exhaustively here.

Remote Streamable HTTP, hosted authentication/pairing, multi-user/editor routing, and managed-service policy remain later-phase work.

### Root build/configuration

- `.nvmrc` pins the initial Node runtime.
- root `package.json` delegates Node build/test work to `mcp-server`.
- `mcp-server/package-lock.json` pins the generated dependency graph.
- GitHub Actions provides Node/protocol/bridge verification where configured.
- Unity runtime/EditMode evidence is recorded separately because GitHub Actions does not by itself prove Unity Editor behavior unless a Unity job actually ran.

## Planned integration/distribution areas

Do not create empty vendor directories merely to mirror an architecture diagram. Add concrete integration files only when a host requires them.

Likely future public layout:

```text
integrations/
├─ portable/        # Agent Plugins / shared packaging metadata if adopted
├─ openai/          # only host-specific metadata/adapters that are genuinely required
├─ anthropic/
├─ google/
└─ other/
```

The canonical product logic remains in the shared MCP/core layers. Provider directories must not become duplicate Unity implementations.

Open-weight/local models are expected to connect through real MCP-capable agent/runtime layers later; model serving/download/GPU scheduling is intentionally outside the Unity core.

## Private hosted infrastructure

`unity-ai-mcp-infra` is intended for managed-service composition/deployment: production auth/database/provider wiring, rate limits/abuse controls, monitoring, deployment pipelines, and private operations.

It should consume/deploy the public core rather than duplicate the core implementation.

## Updating this map

When a meaningful subsystem is added or moved:

1. inspect actual repository paths,
2. update this subsystem-level map if ownership/boundaries changed,
3. update `STATUS.md` if implementation or verification state changed,
4. update `DESIGN.md`/`DECISIONS.md` only if responsibilities/contracts changed,
5. do not enumerate every leaf file unless that detail is genuinely stable and useful.