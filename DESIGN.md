# Unity AI Bridge — System Design

> **Accepted design baseline, not implementation evidence.**
>
> This document records intended system behavior so the project can be resumed without private chat history. `STATUS.md` remains authoritative for what actually exists and is verified. Significant choices and their rationale live in `DECISIONS.md`.

## 1. Product target

A beginner should eventually be able to:

```text
Install Unity package
 -> click Connect AI
 -> pair
 -> use natural language to inspect/edit Unity
```

The user should not need to understand MCP, ports, WebSockets, JSON-RPC, or Unity Editor scripting for the default hosted path.

The reusable public core is licensed under **Apache License 2.0**. The long-term product target remains a public/self-hostable core plus an optional managed convenience service.

## 2. Priorities

In order:

1. correctness and recoverability,
2. beginner usability,
3. security/fail-closed remote control,
4. provider neutrality,
5. public/self-hostable reusable core,
6. extensibility,
7. tool quality over tool count.

## 3. High-level architecture

```text
ChatGPT / Claude / Codex / Gemini / Cursor / other MCP host
                              |
                              | MCP
                              v
                   Public MCP/server core
                     - tool registry
                     - validation
                     - risk/policy metadata
                     - request/result correlation
                     - reusable routing
                              |
                              | versioned Unity bridge protocol
                              | WebSocket first
                              v
                   Unity Editor Agent (C# UPM)
                     - connection lifecycle
                     - command queue
                     - main-thread dispatcher
                     - target resolver
                     - mutation transaction/replay safety
                     - Undo/dirty handling
                     - compile/reload handling
                     - Unity tool handlers
                              |
                              v
                       Unity Editor APIs
```

Managed production identity, storage, rate limiting, monitoring, deployment, and private operational adapters belong in `unity-ai-mcp-infra`. That repository composes/deploys the public core rather than implementing a second private Unity/MCP core.

## 4. Technology direction

### Unity side

- C# Unity Package Manager package.
- Primarily Editor-side automation code.
- Unity API mutations execute through a controlled main-thread boundary.
- Network callbacks do not directly mutate Unity objects.
- Initial verified development target: Unity **6000.3.21f1** (`unity: 6000.3`, `unityRelease: 21f1` in the package manifest).
- The broader/long-term Unity support matrix is unresolved and must be verified rather than inferred from the initial target.

### MCP/server side

Initial implementation baseline:

- TypeScript,
- official MCP TypeScript SDK v2 line,
- Node.js **24.19.0 LTS** initial runtime pin,
- `@modelcontextprotocol/server` **2.0.0**,
- TypeScript **7.0.2**,
- `@types/node` **24.13.3**,
- stdio for the current local MCP path,
- Streamable HTTP as the remote MCP target,
- web-standard-compatible server code where practical.

Direct dependency versions and the generated lockfile are committed. Compatibility claims still require runtime evidence rather than version pins alone.

### Unity bridge transport

The bridge protocol is transport-independent. WebSocket is the first transport implementation.

Local mode uses loopback WebSocket in the current implementation. Hosted mode should use an outbound secure Unity connection so normal users do not need inbound firewall/router configuration.

## 5. Operating modes

### A. Local development/self-host test

```text
local MCP host
 -> public MCP/server core over stdio
 -> localhost Unity bridge
 -> Unity Editor Agent
```

No hosted account should be required.

### B. Easy Connect / managed service

```text
cloud AI host
 -> remote Streamable HTTP MCP/gateway
 -> private production auth/storage/policy adapters
 -> authorized editor route
 -> outbound Unity connection
```

The intended UX hides manual ports and MCP JSON configuration.

### C. Self-hosted remote

Advanced users/teams should eventually be able to deploy the public Apache-2.0 core themselves using documented adapters/configuration without depending on private service logic.

### D. Portable agent/plugin packaging

A future distribution package may use Agent Plugins 1.0 or a successor standard to bundle shared MCP server declarations, skills, and metadata.

This layer is optional and external to core Unity semantics:

```text
portable plugin package
 -> declares/launches or connects to shared MCP core
 -> optional reusable skills
 -> thin host-specific metadata only when required
```

MCP remains the canonical tool boundary. Portable packaging does not replace the MCP server and must not fork Unity command logic.

### E. BYO MCP / adapter mode

Possible future mode only. It must not become a generic unrestricted URL/server proxy. Security review, SSRF protection, capability restriction, and explicit policy are prerequisites.

## 6. Public/private ownership boundary

### Public `unity-ai-bridge`

Reusable behavior belongs here:

- Unity Agent/package,
- bridge protocol,
- MCP tool/server core,
- validation/risk metadata,
- local/self-host path,
- reusable routing abstractions,
- reliability/verification contracts,
- tests and public docs,
- portable integration packaging when appropriate,
- thin publishable provider adapters/metadata only where genuinely required.

### Private `unity-ai-mcp-infra`

Managed-service-specific composition/operations:

- production deployment configuration,
- production identity/auth adapters,
- managed session/database/storage adapters,
- service-specific policy/rate-limit/abuse controls,
- secret-manager wiring (never secret values),
- monitoring/admin/runbooks/deployment pipelines.

If self-hosters need a behavior for basic Unity/MCP operation, it strongly belongs in the public core.

## 7. Bridge protocol model

MCP-facing tools and Unity-facing commands are separate contracts.

Protocol v0 defines source schemas for concepts equivalent to:

```text
protocolVersion
requestId
routed editor/connection identity
operation
arguments
deadline/timeout metadata
risk metadata
```

A result defines concepts equivalent to:

```text
protocolVersion
requestId
ok
result
warnings
changed targets when known
dirty/unsaved state
undo metadata when applicable
compile state when applicable
error { category, code, message, details }
```

Version `0` is pre-stable and may change during early implementation, but schema/type/fixture changes must move together.

## 8. Request identity and retry safety

Every mutation needs a unique request identity.

Example failure:

```text
create Cube
 -> Unity creates Cube
 -> response is lost
 -> caller retries
 -> second Cube created accidentally
```

Transport retry must therefore not automatically mean re-execute the Unity write. Deduplication/idempotency semantics should be appropriate to each operation.

## 9. Unity execution model

Expected mutation path:

```text
network receive
 -> parse
 -> validate envelope
 -> enqueue
 -> Unity main-thread dispatcher
 -> re-resolve/revalidate target
 -> check state preconditions
 -> register Undo when applicable
 -> execute Unity API
 -> native semantic readback
 -> rollback + rollback verification when required
 -> return structured response
```

Rules:

- do not wait on network I/O from Unity's UI/main thread,
- serialize conflicting writes by default,
- parallelism is an optimization that requires evidence/tests,
- a successful delivery/dispatch is not proof that the requested Unity state exists.

## 10. Long-running work

Builds, tests, compilation, asset imports, baking, and similar work should not become giant blocking calls.

A later task model may use states such as:

```text
accepted -> queued -> running -> waiting_for_unity -> completed
                                      |             -> failed
                                      +------------- -> cancelled/timeout
```

Exact task APIs remain unresolved.

## 11. Object/target identity

Unity `InstanceID` is not sufficient as the sole durable protocol identity.

Prefer the strongest identity appropriate to the target:

- asset GUID for assets,
- `GlobalObjectId` where suitable,
- scene identity + hierarchy identity/path + validation metadata for scene objects,
- component identity plus owning-object/type information,
- transient InstanceID only as an optional hint/optimization.

Before mutation, revalidate that the resolved target still matches expected identity/state metadata.

## 12. Compilation and domain reload

Script editing is a workflow, not a simple synchronous property write:

```text
write script
 -> Unity import/compile
 -> possible domain reload
 -> connection may disappear
 -> agent reconnects
 -> compile watcher reports state
 -> caller inspects errors
 -> continue only from current evidence
```

Pending work and connection identity must account for reloads/restarts.

## 13. Connection generations

Reconnects are expected because of:

- domain reload,
- editor restart,
- sleep/network transitions,
- gateway restart,
- stale sockets,
- duplicate connection attempts.

Connections carry explicit generation/epoch concepts so delayed messages from an old socket cannot mutate a newly reconnected editor session.

## 14. Undo, dirty state, and saving

Where Unity supports it:

- register Undo before mutation,
- report whether scenes/assets became dirty,
- do not silently save unless the tool contract explicitly requests save,
- distinguish `changed in Editor` from `persisted to disk`.

A future grouping/transaction feature may make several AI operations undoable as one logical action.

## 15. Tool API strategy

Do not begin with hundreds of independent tool schemas.

Domain families include:

1. editor/status,
2. scene/hierarchy,
3. GameObject/transform,
4. component,
5. console/compiler diagnostics,
6. asset,
7. prefab,
8. script,
9. Play Mode,
10. tests,
11. Undo/recovery.

Names/actions are accepted API only when implemented/versioned in source.

Principles:

- bounded typed actions,
- no giant `do_anything` tool,
- no arbitrary C# execution as an early default fallback,
- frequently used/testable workflows graduate into dedicated actions,
- advanced tool families may be discovered/lazily exposed later,
- tool descriptions/results should remain usable by multiple MCP hosts rather than encode one vendor's private prompting assumptions.

## 16. Risk classes

Conceptual classes:

### READ

No intended project/editor mutation.

### WRITE

Bounded/recoverable mutation such as transform/property editing.

### DESTRUCTIVE

Deletion/overwrite or broad project changes.

### PRIVILEGED

Escapes normal bounded Unity semantics or affects external systems, such as arbitrary code, broad filesystem/process access, credentials/signing/deployment.

Risk metadata does not replace real authorization/policy; it supports it.

## 17. Result/error model

Distinguish at least:

- schema/validation error,
- authentication/authorization/policy rejection,
- no matching editor connection,
- stale/ambiguous target,
- mutation replay/stale replay,
- queued/running timeout/cancellation,
- semantic verification or rollback failure,
- Unity API exception,
- compile/import/reload state,
- disconnected editor,
- unsupported Unity/version capability,
- gateway/transport/internal failure.

`success: true` should mean the requested contract was observed as completed, not merely that a packet arrived.

## 18. Multi-user/multi-editor routing

Hosted routing should model at least:

```text
Account/User
 -> Workspace/Project binding
 -> Editor instance
 -> live connection generation
```

Security invariants:

- an authenticated user may route only to authorized editor instances,
- client-supplied editor IDs are selectors, not authorization,
- ownership/grant checks are server-side,
- one editor disconnect must not invalidate unrelated editors,
- reconnect must not steal another editor's route,
- cross-user command delivery is critical severity.

## 19. Pairing target

Conceptual Easy Connect flow:

1. Unity Agent establishes an outbound limited/unpaired connection.
2. Gateway creates a short-lived human-friendly challenge/code.
3. User approves/binds the connection from the account/client side.
4. Gateway replaces pairing authority with scoped connection credentials.
5. Pairing authority expires and is not a permanent credential.

Exact cryptography, expiry values, identity provider, and credential storage remain unresolved until Phase 4 implementation evidence exists.

## 20. Testing architecture

### Protocol/schema tests

- valid/invalid arguments,
- serialization round trips,
- version compatibility,
- request deduplication,
- error normalization.

### Server/router tests

- tool registration,
- auth/routing boundaries,
- timeout/cancellation,
- reconnect,
- multi-user/editor isolation.

### Unity EditMode tests

- dispatcher,
- object resolver,
- state revision/preconditions,
- mutation lifecycle,
- Undo/rollback behavior,
- dirty-state reporting,
- GameObject/Transform/Component operations,
- Asset/Prefab operations,
- compile/reload helpers where practical.

The package's test assembly is `EunSung.UnityAiBridge.Editor.Tests` and uses Unity's `TestAssemblies` reference. Unity requires non-embedded package dependencies to appear in the consuming project's project-manifest `testables` array before package tests load. For Local, LocalTarball, and Git development installs, the package may add its own package name automatically using the guarded behavior defined in D-019. Registry installs are not automatically modified.

### End-to-end

Required evidence path:

```text
MCP call
 -> server
 -> bridge
 -> Unity main thread
 -> Unity API
 -> semantic/native result
 -> state re-read proves requested effect
```

A mocked Unity unit test alone cannot make a runtime feature `Verified`.

## 21. Compatibility/versioning

Treat these as independent compatibility surfaces:

1. MCP protocol/host compatibility,
2. optional portable-plugin packaging compatibility,
3. Unity bridge protocol compatibility,
4. Unity version/API compatibility.

Do not collapse them into one implicit version.

The bridge protocol is explicitly versioned from its first source implementation as v0. Breaking public schema changes need migration notes once external consumers depend on a versioned contract.

## 22. Integration strategy

The preferred dependency direction is:

```text
shared Unity/MCP core
      |
      +-> ChatGPT metadata/adapter if needed
      +-> Claude metadata/adapter if needed
      +-> Gemini metadata/adapter if needed
      +-> Codex/Cursor/Copilot direct MCP compatibility
      +-> portable Agent Plugins package when useful
```

Rules:

- do not implement duplicate Unity command logic per provider,
- verify each host against the same representative workflow matrix,
- treat host approval UX/auth/distribution differences as integration-layer concerns,
- re-check fast-moving external plugin standards at implementation time,
- a host-specific limitation must be documented rather than hidden by silently weakening core safety semantics.

## 23. Expansion after the core

Candidates include:

- Terrain,
- NavMesh,
- Animation/Animator,
- UI/UI Toolkit,
- Lighting,
- particles/VFX,
- Shader Graph,
- profiler/memory/frame diagnostics,
- builds/package management,
- Multiplayer Play Mode,
- GameView/screenshot inspection,
- safe extension APIs.

Add domains because they are useful and testable, not to hit a marketing number.

## 24. Early non-goals

- reproducing every feature of another Unity MCP project,
- 300+ tools for appearance/marketing,
- arbitrary OS GUI automation,
- Unity Hub account automation,
- unrestricted arbitrary C# execution,
- arbitrary third-party EditorWindow automation,
- billing before the product works,
- TeamForge integration,
- multi-agent orchestration.

## 25. How to resume the project

After losing conversation context:

1. read `AGENTS.md`,
2. read `STATUS.md`,
3. read `CODEMAP.md`,
4. read relevant sections here,
5. read relevant accepted entries in `DECISIONS.md`,
6. inspect current code/tests,
7. continue from repository evidence.

If implementation evidence invalidates a design assumption, record a new decision instead of silently rewriting history.
