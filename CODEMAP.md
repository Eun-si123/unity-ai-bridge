# CODEMAP

This file maps what exists in the repository and what is only planned.

**Rule:** a planned path is not implementation evidence. `STATUS.md` remains authoritative for implementation/verification state.

## Existing source tree

```text
/
├─ .github/workflows/
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
├─ docs/
│  └─ TESTING.md
│
├─ unity-package/
│  ├─ package.json
│  └─ Editor/
│     ├─ UnityAiBridge.Editor.asmdef
│     ├─ Commands/
│     │  ├─ EditorStatusCommand.cs
│     │  ├─ HierarchyCommand.cs
│     │  ├─ GameObjectCreateCommand.cs
│     │  ├─ DiagnosticsCommand.cs
│     │  └─ ObjectResolverCommand.cs
│     ├─ Connection/
│     │  └─ LocalBridgeConnection.cs
│     ├─ Dispatch/
│     │  └─ EditorMainThreadDispatcher.cs
│     └─ Protocol/
│        └─ BridgeProtocol.cs
│
├─ bridge-protocol/
│  ├─ README.md
│  ├─ schemas/
│  │  ├─ command.v0.schema.json
│  │  ├─ hello.v0.schema.json
│  │  └─ result.v0.schema.json
│  └─ fixtures/
│     ├─ editor-status.command.v0.json
│     ├─ editor-status.result.v0.json
│     ├─ hierarchy.command.v0.json
│     ├─ hierarchy.result.v0.json
│     ├─ gameobject-create.command.v0.json
│     ├─ gameobject-create.result.v0.json
│     ├─ diagnostics.command.v0.json
│     ├─ diagnostics.result.v0.json
│     ├─ object-resolve.command.v0.json
│     └─ object-resolve.result.v0.json
│
└─ mcp-server/
   ├─ package.json
   ├─ package-lock.json
   ├─ tsconfig.json
   ├─ src/
   │  ├─ index.ts
   │  ├─ bridge/
   │  │  └─ local-bridge-server.ts
   │  ├─ protocol/
   │  │  └─ bridge.ts
   │  └─ dev/
   │     ├─ verify-unity.ts
   │     ├─ verify-mcp-unity.ts
   │     ├─ verify-reconnect-unity.ts
   │     ├─ verify-hierarchy-unity.ts
   │     ├─ verify-gameobject-create-unity.ts
   │     ├─ verify-diagnostics-unity.ts
   │     └─ verify-object-resolver-unity.ts
   └─ tests/
      ├─ bridge-protocol.test.ts
      ├─ local-bridge.test.ts
      ├─ gameobject-create.test.ts
      ├─ diagnostics.test.ts
      └─ object-resolver.test.ts
```

`STATUS.md` distinguishes implemented source from runtime-verified behavior.

## Documentation responsibilities

- `STATUS.md` — actual implementation and verification state
- `DESIGN.md` — durable detailed design / memory anchor
- `DECISIONS.md` — architecture decision history and rationale
- `ROADMAP.md` — public phases and exit gates
- `ARCHITECTURE.md` — concise high-level boundaries
- `AGENTS.md` — mandatory AI/contributor rules
- `REFERENCES.md` — external research references; not proof of code reuse
- `CHANGELOG.md` — notable project changes
- `docs/TESTING.md` — repeatable automated/manual verification procedures
- `llms.txt` — compact AI entrypoint

## Current source ownership

### `unity-package/`

Current implementation:

- UPM package manifest and Editor-only assembly,
- outbound local `ClientWebSocket` connection/reconnect loop,
- protocol v0 hello/command/result handling,
- explicit editor connection generations and stale-generation rejection,
- Unity main-thread dispatcher,
- `editor.status` read handler,
- bounded `scene.hierarchy` read handler,
- bounded `gameObject.create` write handler,
- create-specific validation, Undo registration, dirty-state handling, `GlobalObjectId` result capture, and same-session mutation replay via `SessionState`,
- `editor.diagnostics` read handler,
- recent log capture through `Application.logMessageReceivedThreaded`,
- compiler warning/error capture through `CompilationPipeline.assemblyCompilationFinished`,
- latest compilation snapshot persistence through domain reload using `SessionState`,
- current Console count reads without relying on internal `UnityEditor.LogEntries`,
- Phase 2 `object.resolve` handler using `GlobalObjectId` native re-resolution,
- Phase 2 native readback and stale replay validation for the bounded GameObject-create path.

All Phase 1 minimum slices are runtime-verified on Windows / Unity 6000.3.21f1 as recorded in `STATUS.md`. The first Phase 2 stable resolver/native readback/stale-replay slice is also runtime-verified on the same Unity target.

### `bridge-protocol/`

Current implementation:

- protocol v0 command, hello, and result JSON Schemas,
- editor-status, hierarchy, GameObject-create, diagnostics, and object-resolve request/result fixtures,
- protocol documentation.

The contract remains separate from MCP so Unity-facing command semantics do not depend on a particular AI provider or MCP transport.

### `mcp-server/`

Current implementation:

- pinned Node/TypeScript/MCP dependency graph and lockfile,
- MCP v2 stdio server,
- local loopback WebSocket bridge,
- request/result correlation and route-generation handling,
- `unity_get_status`,
- `unity_get_hierarchy`,
- `unity_create_game_object`,
- `unity_get_diagnostics`,
- `unity_resolve_object`,
- write-risk routing and mutation-id validation for the create slice,
- bounded diagnostics and resolver validation,
- simulated local-bridge tests,
- real-Unity verification helpers including the verified Phase 2 resolver/Undo/stale-replay verifier.

Remote Streamable HTTP, hosted auth/pairing, multi-user routing, and managed-service policy are not implemented here yet.

### Root build/configuration

- `.nvmrc` pins the initial Node runtime.
- root `package.json` delegates build/test to `mcp-server`.
- `mcp-server/package-lock.json` pins the generated dependency graph.
- GitHub Actions runs Node verification and local-bridge verification.
- `.gitignore` excludes Node/TypeScript outputs and common generated Unity project data.

## Planned top-level areas

These paths remain planned and must not be treated as existing merely because the architecture mentions them:

```text
integrations/
├─ chatgpt/
├─ claude/
└─ other/

additional test areas as needed for future remote/provider E2E coverage
```

Add directories when real implementation/tests need them rather than creating empty architectural placeholders.

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
